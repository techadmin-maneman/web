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
// (src/domain/ops/task-owners.ts).

import { PARTIAL_REASONS } from "../../config/job-sheet.ts";
import { addDays, indiaDate, indiaInstant } from "../../lib/india-time.ts";
import { UNTOLD_MOVE, UNTOLD_REASON } from "../dispatch/dispatch-board.ts";
import { LEAVE_ON_THE_DAY } from "../dispatch/leave.ts";
import { citiesOf, type PlacedId, type PlacedRecord } from "../clients/places.ts";
import { loadSlotSchedule, type SlotSchedule } from "../booking/slot-times.ts";
import { reachesCity, type PlacesReached } from "../../policy/access.ts";
import {
  atRiskIfDoneBy,
  firstFitToBookIfConsultedBy,
  NEXT_VISIT_DAYS,
  offeredWindow,
  type NextVisitDays,
} from "../../policy/next-visit.ts";
import { closedIfSentBy } from "../../policy/one-visit.ts";
import { dueAt, type Slas, type TaskGroup } from "../../policy/tasks.ts";
import { paidNotBooked } from "../booking/hold-stages.ts";
import { statusIn, statusNotIn, VISIT_CALLED_OFF, VISIT_LIVE, VISIT_NOT_BEGUN } from "../../config/statuses.ts";
import type { SqlValue } from "../../lib/sql.ts";

/** A visit to come, by its id and its start. */
export interface TaskVisit {
  readonly id: string;
  readonly starts_at: string;
}

export interface Task {
  readonly id: string;
  readonly group: TaskGroup;
  /**
   * Whose it is; null for an erased client, whose record is gone. The mobile is there only on a move the client has
   * not heard of, for the call.
   */
  readonly person: { readonly id: string; readonly name: string; readonly mobile: string | null } | null;
  /** The visit the dispatch board settles the task on: a move's, a job on leave's. Null for every other group. */
  readonly visit: TaskVisit | null;
  /**
   * The one fact the group turns on: the start a visit moved to, the day and
   * window asked for (and the first fit asked for with them, or the one visit),
   * the piece's label, the fraud rule met, the technician who attended, the
   * invoice in Books, the last visit and the day its next
   * service fell due, the consultation and the window its first fit is offered
   * in, a payment link's state, amount and product, what a disputed charge kept.
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
 * The visit a task settled on the dispatch board is about, so the task links to it there: a move's visit, found by
 * the move, and a job on leave, which is the task's own row. A move also carries its client's mobile, for the call.
 */
const BOARD_VISIT = `
  LEFT JOIN dispatch_moves m ON t."group" = 'untold_move' AND m.id = t.id
  LEFT JOIN appointments v ON v.id = COALESCE(m.appointment_id, CASE WHEN t."group" = 'leave_conflict' THEN t.id END)
  LEFT JOIN people caller ON m.id IS NOT NULL AND caller.id = v.person_id`;

/**
 * One statement's arms, each task with the member of staff ops made it theirs, and the longest wait first. The
 * owner is found by the task's group, its row's id and its episode (docs/decisions/0092-task-owners.md), so one left
 * behind by a task since done lands on no new task about the same row.
 */
const withOwners = (arms: string) => `SELECT t.*, o.owner,
       v.id AS visit_id, v.window_start AS visit_start, caller.mobile_e164 AS person_mobile
  FROM (${arms}) t
  LEFT JOIN task_owners o ON o.task_group = t."group" AND o.subject_id = t.id AND o.episode = t.episode
  ${BOARD_VISIT}
 ORDER BY t.since LIMIT ${String(READ_CAP)}`;

/**
 * A job on a day off is the same conflict wherever it moves within the leave it clashes with, and a new one on leave
 * recorded since: the first leave recorded over it.
 */
const LEAVE_CONFLICT_EPISODE = `(SELECT l.id FROM technician_leave l WHERE ${LEAVE_ON_THE_DAY}
  ORDER BY l.created_at, l.id LIMIT 1)`;

/** A first fit to book is a new task after each later consultation: the consultation it follows. */
const FIRST_FIT_EPISODE = "s.consulted_start";

/**
 * A client with no first fit, service or replacement done since their last consultation. Written exactly as the
 * partial index `last_visits_unfitted` is, so a look reads only those clients.
 */
const NOT_FITTED_SINCE_CONSULTED = "(s.visit_start IS NULL OR s.visit_start < s.consulted_start)";

/** What the board is read at: the moments and the next visit's days its queues compare with. */
interface ReadAt {
  /** India's date. */
  readonly today: string;
  readonly now: string;
  readonly days: NextVisitDays;
  /** The first moment after the last day an at-risk client's last visit can have been done on. */
  readonly atRiskBefore: string;
  /** The first moment after the last day a first fit to book's consultation can have been done on. */
  readonly toBookBefore: string;
  /** The latest a payment link can have been sent and be closed now. */
  readonly linksClosedIfSentBy: string;
}

/**
 * One queue: its tasks, each column named as Row names it, and the parameters it binds, `?1` on. Every queue is read
 * in one batch, a round trip in all, each capped at READ_CAP, which bounds what one look at the board can cost. A
 * person who has been erased is left out everywhere: their record is gone, and a task about them could not be done.
 * A no-show and a disputed charge still wait without them, since each still needs a ruling.
 */
interface Queue {
  readonly sql: string;
  readonly binds?: (at: ReadAt) => readonly SqlValue[];
}

const QUEUES: readonly Queue[] = [
  // A move is still to be told of while its visit is today or later.
  {
    sql: `SELECT 'untold_move' AS "group", m.id AS id, a.person_id AS person_id, pe.name AS person_name,
         m.now_start || ' ' || ${UNTOLD_REASON} AS detail, m.created_at AS since, NULL AS due_by, '' AS episode
    FROM appointments a JOIN dispatch_moves m ON m.appointment_id = a.id JOIN people pe ON pe.id = a.person_id
   WHERE a.deleted_at IS NULL AND ${statusIn("a.status", VISIT_NOT_BEGUN)} AND a.window_start >= ?1
     AND m.now_start >= ?1 AND pe.erased_at IS NULL AND ${UNTOLD_MOVE}`,
    binds: (at) => [at.today],
  },
  // A consultation asked for is read only while the client has no consultation booked or done, `booked`, which the
  // database keeps as their consultations are written (migration 0056). One asked for as a consultation and fit in
  // one visit is booked too once ops have booked the client's first fit (migration 0061).
  {
    sql: `SELECT 'consultation_request' AS "group", r.id AS id, r.person_id AS person_id, pe.name AS person_name,
         r.requested_date || ' ' || r.requested_window
           || CASE WHEN r.one_visit = 1 THEN ' one_visit' || COALESCE(' ' || r.discount_code, '')
                   WHEN f.id IS NULL THEN ''
                   ELSE ' first_fit ' || COALESCE(f.preferred_window, 'any') END AS detail,
         r.created_at AS since, NULL AS due_by, '' AS episode
    FROM consultation_requests r JOIN people pe ON pe.id = r.person_id
    LEFT JOIN first_fit_requests f ON f.person_id = r.person_id
   WHERE r.booked = 0 AND pe.erased_at IS NULL
     AND NOT (r.one_visit = 1 AND EXISTS (
       SELECT 1 FROM appointments fit
        WHERE fit.person_id = r.person_id AND fit.type = 'first_fit' AND fit.deleted_at IS NULL
          AND ${statusNotIn("fit.status", VISIT_CALLED_OFF)}))`,
  },
  // A hair system is to be ordered once it falls due within the lead time ops set, and waits from the day it came
  // within it; a piece is read only while no replacement is booked for it, `replacement_booked`.
  {
    sql: `SELECT 'replacement_order' AS "group", p.id AS id, p.person_id AS person_id, pe.name AS person_name,
         p.piece_code || ' ' || p.replacement_due_at AS detail, date(p.replacement_due_at, ?1) AS since,
         p.replacement_due_at AS due_by, '' AS episode
    FROM pieces p JOIN people pe ON pe.id = p.person_id
   WHERE p.replacement_booked = 0 AND p.deleted_at IS NULL AND p.failed_at IS NULL AND pe.erased_at IS NULL
     AND p.replacement_due_at IS NOT NULL AND p.replacement_due_at <= date(?2, ?3)`,
    binds: (at) => [
      `-${String(at.days.replacement_order_lead)} days`,
      at.today,
      daysOn(at.days.replacement_order_lead),
    ],
  },
  // A grant is read only while it is held.
  {
    sql: `SELECT 'referral_review' AS "group", r.id AS id, c.person_id AS person_id, pe.name AS person_name,
         r.fraud_signals AS detail, r.updated_at AS since, NULL AS due_by, '' AS episode
    FROM referral_attributions r JOIN referral_codes c ON c.code = r.code JOIN people pe ON pe.id = c.person_id
   WHERE r.grant_state = 'held' AND pe.erased_at IS NULL`,
  },
  {
    sql: `SELECT 'grievance' AS "group", g.id AS id, g.person_id AS person_id, pe.name AS person_name, NULL AS detail,
         g.created_at AS since, NULL AS due_by, '' AS episode
    FROM grievances g JOIN people pe ON pe.id = g.person_id
   WHERE g.state = 'open' AND pe.erased_at IS NULL`,
  },
  {
    sql: `SELECT 'no_show_decision' AS "group", n.id AS id, pe.id AS person_id, pe.name AS person_name, t.name AS detail,
         n.created_at AS since, NULL AS due_by, '' AS episode
    FROM no_show_cases n JOIN checkins ci ON ci.id = n.checkin_id JOIN appointments a ON a.id = n.appointment_id
    LEFT JOIN people pe ON pe.id = a.person_id AND pe.erased_at IS NULL
    LEFT JOIN technicians t ON t.id = ci.technician_id
   WHERE n.decision = 'undecided'`,
  },
  {
    sql: `SELECT 'number_change' AS "group", nc.id AS id, nc.person_id AS person_id, pe.name AS person_name,
         NULL AS detail, ${NUMBER_CHANGE_WAITING_SINCE} AS since, NULL AS due_by, '' AS episode
    FROM number_change_requests nc JOIN people pe ON pe.id = nc.person_id
   WHERE nc.state = 'awaiting_ops' AND pe.erased_at IS NULL`,
  },
  {
    sql: `SELECT 'erasure_request' AS "group", d.id AS id, d.person_id AS person_id, pe.name AS person_name,
         NULL AS detail, d.created_at AS since, NULL AS due_by, '' AS episode
    FROM deletion_requests d JOIN people pe ON pe.id = d.person_id
   WHERE d.state = 'requested' AND pe.erased_at IS NULL`,
  },
  {
    sql: `SELECT 'draft_invoice' AS "group", a.id AS id, a.person_id AS person_id, pe.name AS person_name,
         a.fsm_invoice_id AS detail, COALESCE(a.window_end, a.synced_at) AS since, NULL AS due_by, '' AS episode
    FROM appointments a JOIN people pe ON pe.id = a.person_id
   WHERE a.status = 'completed' AND a.invoice_issued_at IS NULL
     AND a.deleted_at IS NULL AND a.fsm_invoice_id IS NOT NULL AND pe.erased_at IS NULL`,
  },
  // A job still booked on a day its technician is away: leave moves nothing, so ops move it. It waits from when the
  // leave was recorded, and falls due by the job. The client is named where there is one on our records.
  {
    sql: `SELECT 'leave_conflict' AS "group", a.id AS id, pe.id AS person_id, pe.name AS person_name,
         a.window_start || ' ' || t.name AS detail,
         (SELECT MIN(l.created_at) FROM technician_leave l WHERE ${LEAVE_ON_THE_DAY}) AS since,
         a.window_start AS due_by, ${LEAVE_CONFLICT_EPISODE} AS episode
    FROM appointments a JOIN technicians t ON t.id = a.technician_id
    LEFT JOIN people pe ON pe.id = a.person_id AND pe.erased_at IS NULL
   WHERE a.deleted_at IS NULL AND ${statusIn("a.status", VISIT_NOT_BEGUN)} AND a.window_start >= ?1
     AND EXISTS (SELECT 1 FROM technician_leave l WHERE ${LEAVE_ON_THE_DAY})`,
    binds: (at) => [at.now],
  },
  // A visit to come whose client has given no address: the technician cannot find the door without one, and the app
  // tells the client "We confirm it with you before your visit". It waits from when the visit first reached us, and
  // falls due by the visit itself.
  {
    sql: `SELECT 'address_to_confirm' AS "group", a.id AS id, a.person_id AS person_id, pe.name AS person_name,
         a.window_start AS detail, COALESCE(a.first_seen_at, a.synced_at) AS since, a.window_start AS due_by,
         '' AS episode
    FROM appointments a JOIN people pe ON pe.id = a.person_id
   WHERE a.deleted_at IS NULL AND ${statusIn("a.status", VISIT_NOT_BEGUN)} AND a.window_start >= ?1
     AND pe.erased_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM addresses d WHERE d.person_id = a.person_id AND d.replaced_at IS NULL)`,
    binds: (at) => [at.now],
  },
  // A visit left partly done waits for the one that finishes it: any visit of the client's booked after it,
  // `followed_up`, which the database keeps as their visits are written (migration 0060), or ops closing it without
  // one, with why (docs/decisions/0092-task-owners.md). A no-show is its own outcome and group; one the Worker before
  // migration 0044 stored as partial is left out too.
  {
    sql: `SELECT 'partial_visit' AS "group", a.id AS id, a.person_id AS person_id, pe.name AS person_name,
         COALESCE((SELECT r.label FROM partial_reasons r WHERE r.code = v.partial_reason), v.partial_reason,
           v.close_reason) AS detail,
         COALESCE(v.ended_at, a.window_end, v.updated_at) AS since, NULL AS due_by, '' AS episode
    FROM visits v JOIN appointments a ON a.id = v.appointment_id JOIN people pe ON pe.id = a.person_id
   WHERE v.outcome = 'partial' AND v.followed_up = 0 AND COALESCE(v.partial_reason, '') <> 'no_show'
     AND a.deleted_at IS NULL AND pe.erased_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM task_closures c WHERE c.task_group = 'partial_visit' AND c.subject_id = a.id)`,
  },
  // An At-risk client is a fitted one with nothing booked since their last first fit, service or replacement, done
  // before ?1: `at_risk_after_due` days past the day their next service fell due. It waits from that day (?2 on from
  // the visit's own), names the visit and the day the service fell due (?3 on), and goes as soon as a visit is
  // booked, paid for, or done after it (docs/decisions/0086-the-next-visit-is-offered.md). It reads each client's
  // last visits from last_visits, which the database keeps as each visit closes (migration 0053), and looks for a
  // visit booked since along indexes that hold only the visits to come or those after it.
  {
    sql: `SELECT 'at_risk_client' AS "group", s.visit_id AS id, s.person_id AS person_id, pe.name AS person_name,
         s.visit_start || ' ' || date(s.visit_start, '+330 minutes', ?3) AS detail,
         date(s.visit_start, '+330 minutes', ?2) AS since, NULL AS due_by, '' AS episode
    FROM last_visits s JOIN people pe ON pe.id = s.person_id
   WHERE s.visit_start < ?1 AND pe.erased_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM appointments live
        WHERE live.person_id = s.person_id AND ${statusIn("live.status", VISIT_LIVE)}
          AND live.deleted_at IS NULL)
     AND NOT EXISTS (
       SELECT 1 FROM appointments later
        WHERE later.person_id = s.person_id AND later.window_start > s.visit_start AND later.deleted_at IS NULL
          AND ${statusNotIn("later.status", VISIT_CALLED_OFF)})
     AND NOT EXISTS (
       SELECT 1 FROM slot_holds h WHERE h.person_id = s.person_id AND ${paidNotBooked("h")})`,
    binds: (at) => [
      at.atRiskBefore,
      daysOn(at.days.service_cadence + at.days.at_risk_after_due),
      daysOn(at.days.service_cadence),
    ],
  },
  // A First fit to book is a client whose last consultation was done before ?1, with no first fit, service or
  // replacement done since, and nothing booked since. A one visit the client declined ends as a consultation, so it
  // counts too. It waits from `first_fit_to_book` days after the consultation (?2 on from it), names the
  // consultation's start, and goes as the at-risk task does. It reads only the clients not fitted since their
  // consultation, along the partial index `last_visits_unfitted`.
  {
    sql: `SELECT 'first_fit_to_book' AS "group", s.person_id AS id, s.person_id AS person_id, pe.name AS person_name,
         s.consulted_start AS detail, date(s.consulted_start, '+330 minutes', ?2) AS since, NULL AS due_by,
         ${FIRST_FIT_EPISODE} AS episode
    FROM last_visits s JOIN people pe ON pe.id = s.person_id
   WHERE s.consulted_start < ?1 AND ${NOT_FITTED_SINCE_CONSULTED} AND pe.erased_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM appointments live
        WHERE live.person_id = s.person_id AND ${statusIn("live.status", VISIT_LIVE)}
          AND live.deleted_at IS NULL)
     AND NOT EXISTS (
       SELECT 1 FROM appointments later
        WHERE later.person_id = s.person_id AND later.window_start > s.consulted_start AND later.deleted_at IS NULL
          AND ${statusNotIn("later.status", VISIT_CALLED_OFF)})
     AND NOT EXISTS (
       SELECT 1 FROM slot_holds h WHERE h.person_id = s.person_id AND ${paidNotBooked("h")})`,
    binds: (at) => [at.toBookBefore, daysOn(at.days.first_fit_to_book)],
  },
  // A one visit's payment link still unpaid (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md): whether
  // Razorpay sent it, has still to, refused it or it has closed unpaid; what it asks for in paise; its address, "-"
  // until it has one; and the product, by name. It waits from the close that asked for it, and goes once Razorpay's
  // webhook says it is paid. The index on the links still unpaid reads only those.
  {
    sql: `SELECT 'payment_owed' AS "group", l.id AS id, a.person_id AS person_id, pe.name AS person_name,
         CASE WHEN l.refused_at IS NOT NULL THEN 'refused' WHEN l.sent_at IS NULL THEN 'unsent'
              WHEN l.sent_at <= ?1 THEN 'closed' ELSE 'sent' END
           || ' ' || l.amount || ' ' || COALESCE(l.short_url, '-') || ' ' || COALESCE(s.name, l.tier) AS detail,
         l.created_at AS since, NULL AS due_by, '' AS episode
    FROM payment_links l JOIN appointments a ON a.id = l.appointment_id JOIN people pe ON pe.id = a.person_id
    LEFT JOIN services s ON s.kind = 'first_fit' AND s.tier = l.tier
   WHERE l.paid_at IS NULL AND pe.erased_at IS NULL`,
    binds: (at) => [at.linksClosedIfSentBy],
  },
  // A client's dispute of a no-show's charge, still to rule on: what the charge kept, in paise. It waits from when the
  // client raised it. The index on the open disputes reads only those.
  {
    sql: `SELECT 'no_show_dispute' AS "group", d.id AS id, pe.id AS person_id, pe.name AS person_name,
         CAST(n.kept_amount AS TEXT) AS detail, d.created_at AS since, NULL AS due_by, '' AS episode
    FROM no_show_disputes d JOIN no_show_cases n ON n.id = d.case_id
    LEFT JOIN people pe ON pe.id = d.person_id AND pe.erased_at IS NULL
   WHERE d.ruling IS NULL`,
  },
  // A payment to refund: why ("let_go", a hold let go whose refund Razorpay would not make, or "refund_failed", a
  // refund Razorpay failed), what is owed back in paise, and the Razorpay payment, for ops to refund from Razorpay's
  // dashboard. It goes once a refund of the payment is made. Migration 0096's indexes read only those two sets.
  {
    sql: `SELECT 'payment_to_refund' AS "group", p.id AS id, pe.id AS person_id, pe.name AS person_name,
         'let_go ' || (p.amount - p.refunded_amount) || ' ' || p.razorpay_payment_id AS detail, h.updated_at AS since,
         NULL AS due_by, '' AS episode
    FROM payments p JOIN slot_holds h ON h.razorpay_order_id = p.razorpay_order_id
    JOIN people pe ON pe.id = h.person_id
   WHERE p.status = 'captured' AND p.appointment_id IS NULL AND h.state = 'released' AND h.refunded_at IS NULL
     AND pe.erased_at IS NULL`,
  },
  {
    sql: `SELECT 'payment_to_refund' AS "group", p.id AS id, pe.id AS person_id, pe.name AS person_name,
         'refund_failed ' || r.amount || ' ' || p.razorpay_payment_id AS detail, r.updated_at AS since,
         NULL AS due_by, '' AS episode
    FROM refunds r JOIN payments p ON p.id = r.payment_id
    JOIN people pe ON pe.id = p.person_id
   WHERE r.status = 'failed' AND p.status <> 'refunded' AND pe.erased_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM refunds later
        WHERE later.payment_id = r.payment_id AND later.status IN ('created', 'processed')
          AND later.created_at > r.created_at)`,
  },
];

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
  visit_id: string | null;
  visit_start: string | null;
  person_mobile: string | null;
}

/** The rules a held grant met, of which the board shows the first (src/domain/referrals/referral-grants.ts). */
function firstSignal(signals: string | null): string | null {
  if (signals === null) return null;
  const parsed = JSON.parse(signals) as unknown;
  return Array.isArray(parsed) && typeof parsed[0] === "string" ? parsed[0] : null;
}

/** A First fit to book's consultation start, then the window its fit is offered in, or "any" where there is none. */
function consultedWithWindow(consultedStart: string, schedule: SlotSchedule): string {
  const window = offeredWindow("first_fit", schedule.at(consultedStart).window);
  return `${consultedStart} ${window ?? "any"}`;
}

/**
 * The one fact a task turns on, as ops read it. A partial visit's is the
 * technician's reason in the words ops gave it: the statement reads them from
 * the reasons ops saved, and a reason from the committed list, which stands
 * until they save one, is named here (docs/decisions/0087-consumables-and-stock.md).
 */
function detailOf(row: Row, schedule: SlotSchedule): string | null {
  if (row.group === "referral_review") return firstSignal(row.detail);
  if (row.group === "first_fit_to_book" && row.detail !== null) return consultedWithWindow(row.detail, schedule);
  if (row.group !== "partial_visit") return row.detail;
  return PARTIAL_REASONS.find((reason) => reason.id === row.detail)?.label ?? row.detail;
}

/** A replacement is due on a calendar date; everything else waits from an instant. */
const instantOf = (since: string) => (since.length === 10 ? indiaInstant(since, "00:00").toISOString() : since);

interface Outstanding {
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
  const at: ReadAt = {
    today,
    now: now.toISOString(),
    days,
    atRiskBefore,
    toBookBefore,
    linksClosedIfSentBy: closedIfSentBy(now).toISOString(),
  };
  const [answers, schedule] = await Promise.all([
    db.batch<Row>(QUEUES.map((queue) => db.prepare(withOwners(queue.sql)).bind(...(queue.binds?.(at) ?? [])))),
    loadSlotSchedule(db),
  ]);
  const truncated = answers.some((answer) => answer.results.length >= READ_CAP);
  // Each queue sorted its own rows; the board wants one list, so they are merged on the same column.
  const results = answers.flatMap((answer) => answer.results).sort((a, b) => a.since.localeCompare(b.since));
  return { tasks: results.map((row) => taskOf(row, sla, schedule)), truncated };
}

/** The group's allowance from when it started waiting, or the visit it is about, whichever comes first. */
function dueOf(row: Row, since: string, sla: Slas): Date {
  const allowed = dueAt(new Date(since), row.group, sla);
  if (row.due_by === null) return allowed;
  const visit = new Date(row.due_by);
  return visit < allowed ? visit : allowed;
}

function personOf(row: Row): Task["person"] {
  if (row.person_id === null || row.person_name === null) return null;
  return { id: row.person_id, name: row.person_name, mobile: row.person_mobile };
}

function visitOf(row: Row): TaskVisit | null {
  if (row.visit_id === null || row.visit_start === null) return null;
  return { id: row.visit_id, starts_at: row.visit_start };
}

function taskOf(row: Row, sla: Slas, schedule: SlotSchedule): Task {
  const since = instantOf(row.since);
  return {
    id: row.id,
    group: row.group,
    person: personOf(row),
    visit: visitOf(row),
    detail: detailOf(row, schedule),
    since,
    due: dueOf(row, since, sla).toISOString(),
    episode: row.episode,
    owner: row.owner,
  };
}

/** The record each group's task is read from, which its id names and which says where the task is. */
const TASK_RECORDS: Readonly<Record<TaskGroup, PlacedRecord>> = {
  untold_move: "move",
  leave_conflict: "visit",
  address_to_confirm: "visit",
  consultation_request: "consultation_request",
  first_fit_to_book: "client",
  replacement_order: "piece",
  at_risk_client: "visit",
  partial_visit: "visit",
  referral_review: "referral",
  no_show_decision: "no_show",
  no_show_dispute: "dispute",
  number_change: "number_change",
  erasure_request: "deletion_request",
  grievance: "grievance",
  draft_invoice: "visit",
  payment_owed: "payment_link",
  payment_to_refund: "payment",
};

const recordOf = (task: Task): PlacedId => ({ kind: TASK_RECORDS[task.group], id: task.id });

/**
 * The tasks within reach: each group's where the caller's grants in the department that decides it reach its record's
 * city. A city is looked up only for a task whose group is not reached everywhere.
 */
export async function tasksWithin(
  db: D1Database,
  tasks: readonly Task[],
  reachOf: (group: TaskGroup) => PlacesReached,
): Promise<Task[]> {
  const toPlace = tasks.filter((task) => reachOf(task.group).kind !== "everywhere");
  if (toPlace.length === 0) return [...tasks];
  const cityOf = await citiesOf(db, toPlace.map(recordOf));
  return tasks.filter((task) => reachesCity(reachOf(task.group), cityOf(recordOf(task))));
}

/** How many have waited past their day. The console reads the same day, so both agree. */
export const overdueCount = (tasks: readonly Task[], now: Date): number =>
  tasks.filter((task) => indiaDate(new Date(task.due)) < indiaDate(now)).length;
