// What ops still have to do (src/policy/tasks.ts), read from the queues the
// database already keeps rather than from a table of its own.
//
// Every group is read in one batch, so the board costs one round trip
// however many tasks it holds. Each arm gives the same seven columns: the group,
// the row's own id, the client it concerns, the one fact behind it, the moment
// it started waiting, and, for a task about a visit still to come, the visit's
// start. The due date follows from that moment and the group's allowance, and
// is never later than the visit; nothing is written anywhere.

import { PARTIAL_REASONS } from "../config/job-sheet.ts";
import { indiaDate, indiaInstant } from "../lib/india-time.ts";
import { UNTOLD_MOVE } from "./dispatch.ts";
import { LEAVE_ON_THE_DAY } from "./leave.ts";
import { dueAt, type Slas, type TaskGroup } from "../policy/tasks.ts";
import { MAX_SYNC_ATTEMPTS } from "../queues/crm-sync.ts";

export interface Task {
  readonly id: string;
  readonly group: TaskGroup;
  /** Whose it is; null for an erased client, whose record is gone. */
  readonly person: { readonly id: string; readonly name: string } | null;
  /**
   * The one fact the group turns on: the start a visit moved to, the day and
   * window asked for, the piece's label, the fraud rule met, the technician who
   * attended, the invoice in Books, the contact in FSM.
   */
  readonly detail: string | null;
  readonly since: string;
  readonly due: string;
}

/**
 * When a number change `nc` started waiting for ops: once the second code was
 * entered, not when it was asked for. The Number changes section counts its
 * deadline from the same moment.
 */
export const NUMBER_CHANGE_WAITING_SINCE = "COALESCE(nc.new_verified_at, nc.created_at)";

/**
 * The most rows one statement reads. Far past any real day's queues, so every
 * count is true below it; a look at a board at least this full says so, rather
 * than counting short in silence.
 */
export const READ_CAP = 2000;

/**
 * Every queue, in three statements sent together. D1 takes at most five arms in one
 * compound SELECT, so the queues are split between statements; a batch is still
 * one round trip. A person who has been erased is left out everywhere: their
 * record is gone, and a task about them could not be done. Two things still
 * wait without them: a no-show, which still needs a ruling, and an erasure FSM
 * would not finish, which names FSM's contact and not the person.
 *
 * The first statement is the one that needs today's date, as `?1`: a move is
 * still to be told of while its visit is today or later. The second
 * needs the attempts after which the sweeper stops asking FSM, as `?1`. The third
 * holds the visits whose booking or closing left ops something to do, and needs
 * the moment ops look, as `?1`. Each takes READ_CAP last, which bounds what one
 * look at the board can cost.
 */
const OUTSTANDING = [
  `SELECT * FROM (
  SELECT 'untold_move' AS "group", m.id AS id, a.person_id AS person_id, pe.name AS person_name,
         m.now_start AS detail, m.created_at AS since, NULL AS due_by
    FROM appointments a JOIN dispatch_moves m ON m.appointment_id = a.id JOIN people pe ON pe.id = a.person_id
   WHERE a.deleted_at IS NULL AND a.status IN ('scheduled', 'dispatched') AND a.window_start >= ?1
     AND pe.erased_at IS NULL AND ${UNTOLD_MOVE}
  UNION ALL
  SELECT 'consultation_request', r.id, r.person_id, pe.name, r.requested_date || ' ' || r.requested_window,
         r.created_at, NULL
    FROM consultation_requests r JOIN people pe ON pe.id = r.person_id
   WHERE pe.erased_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM appointments a
        WHERE a.person_id = r.person_id AND a.type = 'consultation' AND a.deleted_at IS NULL
          AND a.status NOT IN ('cancelled', 'terminated'))
  UNION ALL
  SELECT 'replacement_order', p.id, p.person_id, pe.name, p.piece_code, p.replacement_due_at, NULL
    FROM pieces p JOIN people pe ON pe.id = p.person_id
   WHERE p.deleted_at IS NULL AND p.failed_at IS NULL AND pe.erased_at IS NULL
     AND p.replacement_due_at IS NOT NULL AND p.replacement_due_at <= ?1
     AND NOT EXISTS (
       SELECT 1 FROM appointments a
        WHERE a.person_id = p.person_id AND a.type = 'replacement' AND a.deleted_at IS NULL
          AND a.status NOT IN ('cancelled', 'terminated') AND a.window_start >= p.replacement_due_at)
  UNION ALL
  SELECT 'referral_review', r.id, c.person_id, pe.name, r.fraud_signals, r.updated_at, NULL
    FROM referral_attributions r JOIN referral_codes c ON c.code = r.code JOIN people pe ON pe.id = c.person_id
   WHERE r.grant_state = 'held' AND pe.erased_at IS NULL
  UNION ALL
  SELECT 'grievance', g.id, g.person_id, pe.name, NULL, g.created_at, NULL
    FROM grievances g JOIN people pe ON pe.id = g.person_id
   WHERE g.state = 'open' AND pe.erased_at IS NULL
) ORDER BY since LIMIT ?2`,

  `SELECT * FROM (
  SELECT 'no_show_decision' AS "group", n.id AS id, pe.id AS person_id, pe.name AS person_name, t.name AS detail,
         n.created_at AS since, NULL AS due_by
    FROM no_show_cases n JOIN checkins ci ON ci.id = n.checkin_id JOIN appointments a ON a.id = n.appointment_id
    LEFT JOIN people pe ON pe.id = a.person_id AND pe.erased_at IS NULL
    LEFT JOIN technicians t ON t.id = ci.technician_id
   WHERE n.decision = 'undecided'
  UNION ALL
  SELECT 'number_change', nc.id, nc.person_id, pe.name, NULL, ${NUMBER_CHANGE_WAITING_SINCE}, NULL
    FROM number_change_requests nc JOIN people pe ON pe.id = nc.person_id
   WHERE nc.state = 'awaiting_ops' AND pe.erased_at IS NULL
  UNION ALL
  SELECT 'erasure_request', d.id, d.person_id, pe.name, NULL, d.created_at, NULL
    FROM deletion_requests d JOIN people pe ON pe.id = d.person_id
   WHERE d.state = 'requested' AND pe.erased_at IS NULL
  UNION ALL
  SELECT 'draft_invoice', a.id, a.person_id, pe.name, a.fsm_invoice_id, COALESCE(a.window_end, a.synced_at), NULL
    FROM appointments a JOIN people pe ON pe.id = a.person_id
   WHERE a.status = 'completed' AND a.invoice_issued_at IS NULL AND a.fsm_work_order_id IS NOT NULL
     AND a.deleted_at IS NULL AND a.fsm_invoice_id IS NOT NULL AND pe.erased_at IS NULL
  UNION ALL
  SELECT 'erasure_unfinished', p.id, NULL, NULL, p.fsm_contact_id, p.erased_at, NULL
    FROM people p
   WHERE p.erased_at IS NOT NULL AND p.fsm_contact_id IS NOT NULL AND p.fsm_erased_at IS NULL
     AND p.fsm_erasure_attempts >= ?1
) ORDER BY since LIMIT ?2`,

  // A job still booked on a day its technician is away: leave moves nothing, so ops move it (OPS-07). It waits from
  // when the leave was recorded, and falls due by the job. The client is named where there is one on our records.
  //
  // A visit to come whose client has given no address: the technician cannot find the door without one, and the
  // app tells the client "We confirm it with you before your visit" (LIFE-04). It waits from when the visit first
  // reached us, and falls due by the visit itself.
  //
  // A visit left partly done waits for the one that finishes it: any visit of the client's booked after it. A
  // no-show is its own outcome and group; one the Worker before migration 0044 stored as partial is left out too.
  `SELECT * FROM (
  SELECT 'leave_conflict' AS "group", a.id AS id, pe.id AS person_id, pe.name AS person_name,
         a.window_start || ' ' || t.name AS detail,
         (SELECT MIN(l.created_at) FROM technician_leave l WHERE ${LEAVE_ON_THE_DAY}) AS since,
         a.window_start AS due_by
    FROM appointments a JOIN technicians t ON t.id = a.technician_id
    LEFT JOIN people pe ON pe.id = a.person_id AND pe.erased_at IS NULL
   WHERE a.deleted_at IS NULL AND a.status IN ('scheduled', 'dispatched') AND a.window_start >= ?1
     AND EXISTS (SELECT 1 FROM technician_leave l WHERE ${LEAVE_ON_THE_DAY})
  UNION ALL
  SELECT 'address_to_confirm', a.id, a.person_id, pe.name, a.window_start,
         COALESCE(a.first_seen_at, a.synced_at), a.window_start
    FROM appointments a JOIN people pe ON pe.id = a.person_id
   WHERE a.deleted_at IS NULL AND a.status IN ('scheduled', 'dispatched') AND a.window_start >= ?1
     AND pe.erased_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM addresses d WHERE d.person_id = a.person_id AND d.replaced_at IS NULL)
  UNION ALL
  SELECT 'partial_visit', a.id, a.person_id, pe.name,
         COALESCE((SELECT r.label FROM partial_reasons r WHERE r.code = v.partial_reason), v.partial_reason),
         COALESCE(v.ended_at, a.window_end, v.updated_at), NULL
    FROM visits v JOIN appointments a ON a.id = v.appointment_id JOIN people pe ON pe.id = a.person_id
   WHERE v.outcome = 'partial' AND COALESCE(v.partial_reason, '') <> 'no_show' AND a.deleted_at IS NULL
     AND pe.erased_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM appointments later
        WHERE later.person_id = a.person_id AND later.deleted_at IS NULL
          AND later.status NOT IN ('cancelled', 'terminated') AND later.window_start > a.window_start)
) ORDER BY since LIMIT ?2`,
] as const;

interface Row {
  group: TaskGroup;
  id: string;
  person_id: string | null;
  person_name: string | null;
  detail: string | null;
  since: string;
  /** The start of the visit a task is about, which it may fall due no later than. */
  due_by: string | null;
}

/** The rules a held grant met, of which the board shows the first (src/domain/referral-grants.ts). */
function firstSignal(signals: string | null): string | null {
  if (signals === null) return null;
  const parsed = JSON.parse(signals) as unknown;
  return Array.isArray(parsed) && typeof parsed[0] === "string" ? parsed[0] : null;
}

/**
 * The one fact a task turns on, as ops read it. A partial visit's is the
 * technician's reason in the words ops gave it: the statement reads them from
 * the reasons ops saved, and a reason from the committed list, which stands
 * until they save one, is named here (docs/decisions/0087-consumables-and-stock.md).
 */
function detailOf(row: Row): string | null {
  if (row.group === "referral_review") return firstSignal(row.detail);
  if (row.group !== "partial_visit") return row.detail;
  return PARTIAL_REASONS.find((reason) => reason.id === row.detail)?.label ?? row.detail;
}

/** A replacement is due on a calendar date; everything else waits from an instant. */
const instantOf = (since: string) => (since.length === 10 ? indiaInstant(since, "00:00").toISOString() : since);

export interface Outstanding {
  /** The longest wait first. */
  readonly tasks: Task[];
  /** A statement reached READ_CAP, so some task, and every count it belongs to, may be missing. */
  readonly truncated: boolean;
}

/** What ops still have to do, the longest wait first. */
export async function outstandingTasks(db: D1Database, now: Date, sla: Slas): Promise<Outstanding> {
  const answers = await db.batch<Row>([
    db.prepare(OUTSTANDING[0]).bind(indiaDate(now), READ_CAP),
    db.prepare(OUTSTANDING[1]).bind(MAX_SYNC_ATTEMPTS, READ_CAP),
    db.prepare(OUTSTANDING[2]).bind(now.toISOString(), READ_CAP),
  ]);
  const truncated = answers.some((answer) => answer.results.length >= READ_CAP);
  // Each statement sorted its own rows; the board wants one list, so they are merged on the same column.
  const results = answers.flatMap((answer) => answer.results).sort((a, b) => a.since.localeCompare(b.since));
  return { tasks: results.map((row) => taskOf(row, sla)), truncated };
}

/** The group's allowance from when it started waiting, or the visit it is about, whichever comes first. */
function dueOf(row: Row, since: string, sla: Slas): Date {
  const allowed = dueAt(new Date(since), row.group, sla);
  if (row.due_by === null) return allowed;
  const visit = new Date(row.due_by);
  return visit < allowed ? visit : allowed;
}

function taskOf(row: Row, sla: Slas): Task {
  const since = instantOf(row.since);
  return {
    id: row.id,
    group: row.group,
    person: row.person_id === null || row.person_name === null ? null : { id: row.person_id, name: row.person_name },
    detail: detailOf(row),
    since,
    due: dueOf(row, since, sla).toISOString(),
  };
}

/** How many have waited past their day. The console reads the same day, so both agree. */
export const overdueCount = (tasks: readonly Task[], now: Date): number =>
  tasks.filter((task) => indiaDate(new Date(task.due)) < indiaDate(now)).length;
