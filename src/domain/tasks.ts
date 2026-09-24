// What ops still have to do (src/policy/tasks.ts), read from the queues the
// database already keeps rather than from a table of its own.
//
// All six groups are read in one batch, so the board costs one round trip
// however many tasks it holds. Each arm gives the same six columns: the group,
// the row's own id, the client it concerns, the one fact behind it, and the
// moment it started waiting. The due date follows from that moment and the
// group's allowance, and nothing is written anywhere.

import { indiaDate, indiaInstant } from "../lib/india-time.ts";
import { dueAt, type Slas, type TaskGroup } from "../policy/tasks.ts";

export interface Task {
  readonly id: string;
  readonly group: TaskGroup;
  /** Whose it is; null for a no-show, whose case names the technician and never the client. */
  readonly person: { readonly id: string; readonly name: string } | null;
  /**
   * The one fact the group turns on: the day and window asked for, the piece's
   * label, the fraud rule met, the technician who attended.
   */
  readonly detail: string | null;
  readonly since: string;
  readonly due: string;
}

/**
 * Every queue, in two statements sent together. D1 takes at most five arms in one
 * compound SELECT, so the sixth queue starts a second statement; a batch is still
 * one round trip. A person who has been erased is left out everywhere: their
 * record is gone, and a task about them could not be done.
 *
 * The first statement is the one that needs today's date, as `?1`; both take the
 * limit last, so neither can answer with more than the board holds.
 */
const OUTSTANDING = [
  `SELECT * FROM (
  SELECT 'consultation_request' AS "group", r.id AS id, r.person_id AS person_id, pe.name AS person_name,
         r.requested_date || ' ' || r.requested_window AS detail, r.created_at AS since
    FROM consultation_requests r JOIN people pe ON pe.id = r.person_id
   WHERE pe.erased_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM appointments a
        WHERE a.person_id = r.person_id AND a.type = 'consultation' AND a.deleted_at IS NULL
          AND a.status NOT IN ('cancelled', 'terminated'))
  UNION ALL
  SELECT 'replacement_order', p.id, p.person_id, pe.name, p.piece_code, p.replacement_due_at
    FROM pieces p JOIN people pe ON pe.id = p.person_id
   WHERE p.deleted_at IS NULL AND p.failed_at IS NULL AND pe.erased_at IS NULL
     AND p.replacement_due_at IS NOT NULL AND p.replacement_due_at <= ?1
     AND NOT EXISTS (
       SELECT 1 FROM appointments a
        WHERE a.person_id = p.person_id AND a.type = 'replacement' AND a.deleted_at IS NULL
          AND a.status NOT IN ('cancelled', 'terminated') AND a.window_start >= p.replacement_due_at)
  UNION ALL
  SELECT 'referral_review', r.id, c.person_id, pe.name, r.fraud_signals, r.updated_at
    FROM referral_attributions r JOIN referral_codes c ON c.code = r.code JOIN people pe ON pe.id = c.person_id
   WHERE r.grant_state = 'held' AND pe.erased_at IS NULL
) ORDER BY since LIMIT ?2`,

  `SELECT * FROM (
  SELECT 'no_show_decision' AS "group", n.id AS id, NULL AS person_id, NULL AS person_name, t.name AS detail,
         n.created_at AS since
    FROM no_show_cases n JOIN checkins ci ON ci.id = n.checkin_id
    LEFT JOIN technicians t ON t.id = ci.technician_id
   WHERE n.decision = 'undecided'
  UNION ALL
  SELECT 'number_change', nc.id, nc.person_id, pe.name, NULL, COALESCE(nc.new_verified_at, nc.created_at)
    FROM number_change_requests nc JOIN people pe ON pe.id = nc.person_id
   WHERE nc.state = 'awaiting_ops' AND pe.erased_at IS NULL
  UNION ALL
  SELECT 'erasure_request', d.id, d.person_id, pe.name, NULL, d.created_at
    FROM deletion_requests d JOIN people pe ON pe.id = d.person_id
   WHERE d.state = 'requested' AND pe.erased_at IS NULL
) ORDER BY since LIMIT ?1`,
] as const;

interface Row {
  group: TaskGroup;
  id: string;
  person_id: string | null;
  person_name: string | null;
  detail: string | null;
  since: string;
}

/** The rules a held grant met, of which the board shows the first (src/domain/referral-grants.ts). */
function firstSignal(signals: string | null): string | null {
  if (signals === null) return null;
  const parsed = JSON.parse(signals) as unknown;
  return Array.isArray(parsed) && typeof parsed[0] === "string" ? parsed[0] : null;
}

/** A replacement is due on a calendar date; everything else waits from an instant. */
const instantOf = (since: string) => (since.length === 10 ? indiaInstant(since, "00:00").toISOString() : since);

/** What ops still have to do, the longest wait first. */
export async function outstandingTasks(db: D1Database, now: Date, limit: number, sla: Slas): Promise<Task[]> {
  const answers = await db.batch<Row>([
    db.prepare(OUTSTANDING[0]).bind(indiaDate(now), limit),
    db.prepare(OUTSTANDING[1]).bind(limit),
  ]);
  // Each statement sorted its own rows; the board wants one list, so they are
  // merged on the same column and cut to the same limit.
  const results = answers
    .flatMap((answer) => answer.results)
    .sort((a, b) => a.since.localeCompare(b.since))
    .slice(0, limit);
  return results.map((row) => {
    const since = instantOf(row.since);
    return {
      id: row.id,
      group: row.group,
      person: row.person_id === null || row.person_name === null ? null : { id: row.person_id, name: row.person_name },
      detail: row.group === "referral_review" ? firstSignal(row.detail) : row.detail,
      since,
      due: dueAt(new Date(since), row.group, sla).toISOString(),
    };
  });
}

/** How many have waited past their day. The console reads the same day, so both agree. */
export const overdueCount = (tasks: readonly Task[], now: Date): number =>
  tasks.filter((task) => indiaDate(new Date(task.due)) < indiaDate(now)).length;
