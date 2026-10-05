// The no-shows ops have ruled on, as No-shows lists the day's rulings beneath its queue, so a case just charged or
// waived can still be seen (src/domain/no-shows.ts).

import { indiaDate } from "../lib/india-time.ts";
import type { PlacesReached } from "../policy/access.ts";
import type { NoShowDecision } from "../policy/no-show.ts";
import { CHARGE_TAKEN, chargeTaken, type ChargeColumns, type NoShowNote } from "./no-shows.ts";
import { reachBinding, withinReach } from "./places.ts";

/** A case ops have ruled on, with what the ruling did. */
interface DecidedCase {
  readonly id: string;
  /** Whose visit it was; null once they have been erased. */
  readonly person: { readonly id: string; readonly name: string } | null;
  readonly visit_date: string | null;
  readonly decision: Exclude<NoShowDecision, "undecided">;
  readonly decided_at: string;
  /** What a charge took. Null for a waiver, and for a charge ruled before charges were recorded. */
  readonly charge: NoShowNote["charge"];
}

interface DecidedRow extends ChargeColumns {
  id: string;
  person_id: string | null;
  person_name: string | null;
  window_start: string | null;
  decision: Exclude<NoShowDecision, "undecided">;
  decided_at: string;
}

/** The cases in the places reached ruled on at or after `since`, the latest first. */
export async function casesDecidedSince(
  db: D1Database,
  since: Date,
  limit: number,
  reached: PlacesReached,
): Promise<DecidedCase[]> {
  const { results } = await db
    .prepare(
      `SELECT n.id, pe.id AS person_id, pe.name AS person_name, a.window_start, n.decision, n.decided_at, n.charge,
         ${CHARGE_TAKEN}
       FROM no_show_cases n JOIN appointments a ON a.id = n.appointment_id
       LEFT JOIN people pe ON pe.id = a.person_id AND pe.erased_at IS NULL
       WHERE n.decision IN ('charged', 'waived') AND n.decided_at >= ?1 AND ${withinReach("no_show", "n", "?3")}
       ORDER BY n.decided_at DESC
       LIMIT ?2`,
    )
    .bind(since.toISOString(), limit, reachBinding(reached))
    .all<DecidedRow>();
  return results.map((row) => ({
    id: row.id,
    person: row.person_id === null || row.person_name === null ? null : { id: row.person_id, name: row.person_name },
    visit_date: row.window_start === null ? null : indiaDate(new Date(row.window_start)),
    decision: row.decision,
    decided_at: row.decided_at,
    charge: chargeTaken(row),
  }));
}
