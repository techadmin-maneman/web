// What ops still have to do (src/policy/tasks.ts), read from the queues the
// database already keeps rather than from a table of its own.
//
// Every group is read in one batch, so the board costs one round trip
// however many tasks it holds. Each arm gives the same seven columns: the group,
// the row's own id, the client it concerns, the one fact behind it, the moment
// it started waiting, and, for a task about a visit still to come, the visit's
// start. The due date follows from that moment and the group's allowance, and
// is never later than the visit; nothing is written anywhere. Whose each task
// is, where ops made it someone's, is kept apart and read beside it
// (src/domain/task-owners.ts).

import { PARTIAL_REASONS } from "../config/job-sheet.ts";
import { addDays, indiaDate, indiaInstant } from "../lib/india-time.ts";
import { UNTOLD_MOVE } from "./dispatch.ts";
import { LEAVE_ON_THE_DAY } from "./leave.ts";
import {
  atRiskIfDoneBy,
  firstFitToBookIfConsultedBy,
  NEXT_VISIT_DAYS,
  type NextVisitDays,
} from "../policy/next-visit.ts";
import { dueAt, type Slas, type TaskGroup } from "../policy/tasks.ts";

export interface Task {
  readonly id: string;
  readonly group: TaskGroup;
  /** Whose it is; null for an erased client, whose record is gone. */
  readonly person: { readonly id: string; readonly name: string } | null;
  /**
   * The one fact the group turns on: the start a visit moved to, the day and
   * window asked for (and the first fit asked for with them, or the one visit),
   * the piece's label, the fraud rule met, the technician who attended, the
   * invoice in Books, the last visit and the day its next
   * service fell due, the consultation and the window a first fit was asked
   * for in, a payment link's state, amount and product.
   */
  readonly detail: string | null;
  readonly since: string;
  readonly due: string;
  /**
   * Which task it is, where its row can be a new task again once this one has gone: a job's leave, a first fit's
   * consultation. Empty for every other group. Its owner is kept for it alone.
   */
  readonly episode: string;
  /** The Access e-mail of the member of staff it is theirs; null while nobody has taken it. */
  readonly owner: string | null;
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
 * One statement's arms, each task with the member of staff ops made it theirs, and the longest wait first. The
 * owner is found by the task's group, its row's id and its episode (docs/decisions/0092-task-owners.md), so one left
 * behind by a task since done lands on no new task about the same row.
 */
const withOwners = (arms: string) => `SELECT t.*, o.owner FROM (${arms}) t
  LEFT JOIN task_owners o ON o.task_group = t."group" AND o.subject_id = t.id AND o.episode = t.episode
 ORDER BY t.since LIMIT ?2`;

/**
 * A job on a day off is the same conflict wherever it moves within the leave it clashes with, and a new one on leave
 * recorded since: the first leave recorded over it.
 */
const LEAVE_CONFLICT_EPISODE = `(SELECT l.id FROM technician_leave l WHERE ${LEAVE_ON_THE_DAY}
  ORDER BY l.created_at, l.id LIMIT 1)`;

/**
 * A first fit to book is a new task when a later consultation follows the same request, and the same one when the
 * request is asked for again while it waits: the consultation it follows.
 */
const FIRST_FIT_EPISODE = "s.consulted_start";

/**
 * Every queue, in three statements sent together. D1 takes at most five arms in one
 * compound SELECT, so the queues are split between statements; a batch is still
 * one round trip. A person who has been erased is left out everywhere: their
 * record is gone, and a task about them could not be done. A no-show still
 * waits without them, since it still needs a ruling.
 *
 * The first statement is the one that needs today's date, as `?1`: a move is
 * still to be told of while its visit is today or later. The third holds the
 * visits whose booking or closing left ops something to do, and needs the
 * moment ops look, as `?1`, and what the next visit's days make of it (`?3` to
 * `?7`, below). The second, and the fourth, which holds the one visits'
 * payments still owed, need nothing but READ_CAP. Each takes READ_CAP as `?2`,
 * which bounds what one look at the board can cost. The first and the third
 * hold five arms each; the second and the fourth have room.
 *
 * A consultation asked for is read only while the client has no consultation
 * booked or done, `booked`, which the database keeps as their consultations are
 * written (migration 0056): a look reads the requests still waiting, not every
 * request a lead ever made. One asked for as a consultation and fit in one visit
 * is booked too once ops have booked the client's first fit, which migration
 * 0061's triggers keep; the arm still asks for the first fit itself, since a
 * consultation of the client's written later sets `booked` by consultations alone. So with the rest (migration 0060): a move ops made is
 * read only while its visit is to come and nobody has recorded a call about it, a
 * piece only while no replacement is booked for it, `replacement_booked`, and a
 * grant only while it is held.
 */
const OUTSTANDING = [
  withOwners(`
  SELECT 'untold_move' AS "group", m.id AS id, a.person_id AS person_id, pe.name AS person_name,
         m.now_start AS detail, m.created_at AS since, NULL AS due_by, '' AS episode
    FROM appointments a JOIN dispatch_moves m ON m.appointment_id = a.id JOIN people pe ON pe.id = a.person_id
   WHERE a.deleted_at IS NULL AND a.status IN ('scheduled', 'dispatched') AND a.window_start >= ?1
     AND m.now_start >= ?1 AND pe.erased_at IS NULL AND ${UNTOLD_MOVE}
  UNION ALL
  SELECT 'consultation_request', r.id, r.person_id, pe.name,
         r.requested_date || ' ' || r.requested_window
           || CASE WHEN r.one_visit = 1 THEN ' one_visit' || COALESCE(' ' || r.discount_code, '')
                   WHEN f.id IS NULL THEN ''
                   ELSE ' first_fit ' || COALESCE(f.preferred_window, 'any') END,
         r.created_at, NULL, ''
    FROM consultation_requests r JOIN people pe ON pe.id = r.person_id
    LEFT JOIN first_fit_requests f ON f.person_id = r.person_id
   WHERE r.booked = 0 AND pe.erased_at IS NULL
     AND NOT (r.one_visit = 1 AND EXISTS (
       SELECT 1 FROM appointments fit
        WHERE fit.person_id = r.person_id AND fit.type = 'first_fit' AND fit.deleted_at IS NULL
          AND fit.status NOT IN ('cancelled', 'terminated')))
  UNION ALL
  SELECT 'replacement_order', p.id, p.person_id, pe.name, p.piece_code, p.replacement_due_at, NULL, ''
    FROM pieces p JOIN people pe ON pe.id = p.person_id
   WHERE p.replacement_booked = 0 AND p.deleted_at IS NULL AND p.failed_at IS NULL AND pe.erased_at IS NULL
     AND p.replacement_due_at IS NOT NULL AND p.replacement_due_at <= ?1
  UNION ALL
  SELECT 'referral_review', r.id, c.person_id, pe.name, r.fraud_signals, r.updated_at, NULL, ''
    FROM referral_attributions r JOIN referral_codes c ON c.code = r.code JOIN people pe ON pe.id = c.person_id
   WHERE r.grant_state = 'held' AND pe.erased_at IS NULL
  UNION ALL
  SELECT 'grievance', g.id, g.person_id, pe.name, NULL, g.created_at, NULL, ''
    FROM grievances g JOIN people pe ON pe.id = g.person_id
   WHERE g.state = 'open' AND pe.erased_at IS NULL
`),

  withOwners(`
  SELECT 'no_show_decision' AS "group", n.id AS id, pe.id AS person_id, pe.name AS person_name, t.name AS detail,
         n.created_at AS since, NULL AS due_by, '' AS episode
    FROM no_show_cases n JOIN checkins ci ON ci.id = n.checkin_id JOIN appointments a ON a.id = n.appointment_id
    LEFT JOIN people pe ON pe.id = a.person_id AND pe.erased_at IS NULL
    LEFT JOIN technicians t ON t.id = ci.technician_id
   WHERE n.decision = 'undecided'
  UNION ALL
  SELECT 'number_change', nc.id, nc.person_id, pe.name, NULL, ${NUMBER_CHANGE_WAITING_SINCE}, NULL, ''
    FROM number_change_requests nc JOIN people pe ON pe.id = nc.person_id
   WHERE nc.state = 'awaiting_ops' AND pe.erased_at IS NULL
  UNION ALL
  SELECT 'erasure_request', d.id, d.person_id, pe.name, NULL, d.created_at, NULL, ''
    FROM deletion_requests d JOIN people pe ON pe.id = d.person_id
   WHERE d.state = 'requested' AND pe.erased_at IS NULL
  UNION ALL
  SELECT 'draft_invoice', a.id, a.person_id, pe.name, a.fsm_invoice_id, COALESCE(a.window_end, a.synced_at), NULL,
         ''
    FROM appointments a JOIN people pe ON pe.id = a.person_id
   WHERE a.status = 'completed' AND a.invoice_issued_at IS NULL
     AND a.deleted_at IS NULL AND a.fsm_invoice_id IS NOT NULL AND pe.erased_at IS NULL
`),

  // A job still booked on a day its technician is away: leave moves nothing, so ops move it (OPS-07). It waits from
  // when the leave was recorded, and falls due by the job. The client is named where there is one on our records.
  //
  // A visit to come whose client has given no address: the technician cannot find the door without one, and the
  // app tells the client "We confirm it with you before your visit" (LIFE-04). It waits from when the visit first
  // reached us, and falls due by the visit itself.
  //
  // A visit left partly done waits for the one that finishes it: any visit of the client's booked after it,
  // `followed_up`, which the database keeps as their visits are written (migration 0060), or ops closing it without
  // one, with why (docs/decisions/0092-task-owners.md). A no-show is its own outcome and group;
  // one the Worker before migration 0044 stored as partial is left out too.
  //
  // An At-risk client is a fitted one with nothing booked since their last first fit, service or replacement, done
  // on or before ?3's day in India: `at_risk_after_due` days past the day their next service fell due. It waits
  // from that day (?4 on from the visit's own), names the visit and the day the service fell due (?7 on), and goes
  // as soon as a visit is booked, paid for, or done after it (docs/decisions/0086-the-next-visit-is-offered.md).
  //
  // A First fit to book is a fit asked for on the site's form whose consultation was done on or before ?5's day,
  // with nothing booked since. It waits from `first_fit_to_book` days after the consultation (?6 on from it), names
  // the consultation's start and the window asked for, and goes as the at-risk task does.
  //
  // Both read each client's last visits from last_visits, which the database keeps as each visit closes (migration
  // 0053), and look for a visit booked since along indexes that hold only the visits to come or those after it: so a
  // look reads about a row a client, however many visits each has had. A First fit to book reads only the requests
  // of clients not fitted since their consultation, `fitted_since`, kept from last_visits (migration 0056), and not
  // every request a client who has long since been fitted once made.
  withOwners(`
  SELECT 'leave_conflict' AS "group", a.id AS id, pe.id AS person_id, pe.name AS person_name,
         a.window_start || ' ' || t.name AS detail,
         (SELECT MIN(l.created_at) FROM technician_leave l WHERE ${LEAVE_ON_THE_DAY}) AS since,
         a.window_start AS due_by, ${LEAVE_CONFLICT_EPISODE} AS episode
    FROM appointments a JOIN technicians t ON t.id = a.technician_id
    LEFT JOIN people pe ON pe.id = a.person_id AND pe.erased_at IS NULL
   WHERE a.deleted_at IS NULL AND a.status IN ('scheduled', 'dispatched') AND a.window_start >= ?1
     AND EXISTS (SELECT 1 FROM technician_leave l WHERE ${LEAVE_ON_THE_DAY})
  UNION ALL
  SELECT 'address_to_confirm', a.id, a.person_id, pe.name, a.window_start,
         COALESCE(a.first_seen_at, a.synced_at), a.window_start, ''
    FROM appointments a JOIN people pe ON pe.id = a.person_id
   WHERE a.deleted_at IS NULL AND a.status IN ('scheduled', 'dispatched') AND a.window_start >= ?1
     AND pe.erased_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM addresses d WHERE d.person_id = a.person_id AND d.replaced_at IS NULL)
  UNION ALL
  SELECT 'partial_visit', a.id, a.person_id, pe.name,
         COALESCE((SELECT r.label FROM partial_reasons r WHERE r.code = v.partial_reason), v.partial_reason,
           v.close_reason),
         COALESCE(v.ended_at, a.window_end, v.updated_at), NULL, ''
    FROM visits v JOIN appointments a ON a.id = v.appointment_id JOIN people pe ON pe.id = a.person_id
   WHERE v.outcome = 'partial' AND v.followed_up = 0 AND COALESCE(v.partial_reason, '') <> 'no_show'
     AND a.deleted_at IS NULL AND pe.erased_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM task_closures c WHERE c.task_group = 'partial_visit' AND c.subject_id = a.id)
  UNION ALL
  SELECT 'at_risk_client', s.visit_id, s.person_id, pe.name,
         s.visit_start || ' ' || date(s.visit_start, '+330 minutes', ?7),
         date(s.visit_start, '+330 minutes', ?4), NULL, ''
    FROM last_visits s JOIN people pe ON pe.id = s.person_id
   WHERE s.visit_start < ?3 AND pe.erased_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM appointments live
        WHERE live.person_id = s.person_id AND live.status IN ('scheduled', 'dispatched', 'in_progress')
          AND live.deleted_at IS NULL)
     AND NOT EXISTS (
       SELECT 1 FROM appointments later
        WHERE later.person_id = s.person_id AND later.window_start > s.visit_start AND later.deleted_at IS NULL
          AND later.status NOT IN ('cancelled', 'terminated'))
     AND NOT EXISTS (
       SELECT 1 FROM slot_holds h WHERE h.person_id = s.person_id AND h.state = 'held' AND h.confirmed_at IS NOT NULL)
  UNION ALL
  SELECT 'first_fit_to_book', r.id, r.person_id, pe.name,
         s.consulted_start || ' ' || COALESCE(r.preferred_window, 'any'),
         date(s.consulted_start, '+330 minutes', ?6), NULL, ${FIRST_FIT_EPISODE}
    FROM first_fit_requests r JOIN last_visits s ON s.person_id = r.person_id JOIN people pe ON pe.id = r.person_id
   WHERE r.fitted_since = 0 AND s.consulted_start < ?5 AND pe.erased_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM appointments live
        WHERE live.person_id = r.person_id AND live.status IN ('scheduled', 'dispatched', 'in_progress')
          AND live.deleted_at IS NULL)
     AND NOT EXISTS (
       SELECT 1 FROM appointments later
        WHERE later.person_id = r.person_id AND later.window_start > s.consulted_start AND later.deleted_at IS NULL
          AND later.status NOT IN ('cancelled', 'terminated'))
     AND NOT EXISTS (
       SELECT 1 FROM slot_holds h WHERE h.person_id = r.person_id AND h.state = 'held' AND h.confirmed_at IS NOT NULL)
`),

  // A one visit's payment link still unpaid (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md): whether
  // Razorpay sent it, what it asks for in paise, and the product, by name. It waits from the close that asked for it,
  // and goes once Razorpay's webhook says it is paid. The index on the links still unpaid reads only those.
  withOwners(`
  SELECT 'payment_owed' AS "group", l.id AS id, a.person_id AS person_id, pe.name AS person_name,
         CASE WHEN l.sent_at IS NULL THEN 'unsent' ELSE 'sent' END || ' ' || l.amount || ' '
           || COALESCE(s.name, l.tier) AS detail,
         l.created_at AS since, NULL AS due_by, '' AS episode
    FROM payment_links l JOIN appointments a ON a.id = l.appointment_id JOIN people pe ON pe.id = a.person_id
    LEFT JOIN services s ON s.kind = 'first_fit' AND s.tier = l.tier
   WHERE l.paid_at IS NULL AND pe.erased_at IS NULL
`),
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
  episode: string;
  owner: string | null;
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

/** SQLite's modifier for a date `days` on: "+37 days". */
const daysOn = (days: number) => `+${String(days)} days`;

/**
 * What ops still have to do, the longest wait first. `days` are the next visit's figures ops set
 * (src/policy/next-visit.ts), which At-risk client and First fit to book are counted by.
 */
export async function outstandingTasks(
  db: D1Database,
  now: Date,
  sla: Slas,
  days: NextVisitDays = NEXT_VISIT_DAYS,
): Promise<Outstanding> {
  const today = indiaDate(now);
  // The first moment after each last day, as the instants the visits' starts are compared with.
  const atRiskBefore = indiaInstant(addDays(atRiskIfDoneBy(today, days), 1), "00:00").toISOString();
  const toBookBefore = indiaInstant(addDays(firstFitToBookIfConsultedBy(today, days), 1), "00:00").toISOString();
  const answers = await db.batch<Row>([
    db.prepare(OUTSTANDING[0]).bind(today, READ_CAP),
    // Its one number is READ_CAP, which every statement takes as ?2.
    db.prepare(OUTSTANDING[1]).bind(null, READ_CAP),
    db
      .prepare(OUTSTANDING[2])
      .bind(
        now.toISOString(),
        READ_CAP,
        atRiskBefore,
        daysOn(days.service_cadence + days.at_risk_after_due),
        toBookBefore,
        daysOn(days.first_fit_to_book),
        daysOn(days.service_cadence),
      ),
    // Its one number is READ_CAP, which every statement takes as ?2.
    db.prepare(OUTSTANDING[3]).bind(null, READ_CAP),
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
    episode: row.episode,
    owner: row.owner,
  };
}

/** How many have waited past their day. The console reads the same day, so both agree. */
export const overdueCount = (tasks: readonly Task[], now: Date): number =>
  tasks.filter((task) => indiaDate(new Date(task.due)) < indiaDate(now)).length;
