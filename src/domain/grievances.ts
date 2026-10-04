// A client's concerns about how we use their data: the ones their profile shows them, and one message an hour to the
// team chat about new ones.

import { DAY_MS, HOUR_MS } from "../lib/durations.ts";
import { DECISION_SHOWN_DAYS } from "../policy/decision-reasons.ts";
import { GRIEVANCES_SHOWN } from "../policy/grievances.ts";

export interface ShownGrievance {
  readonly id: string;
  readonly text: string;
  readonly state: "open" | "resolved";
  readonly raisedAt: string;
  /** Ops' answer, which they write knowing the client reads it; null while open. */
  readonly response: string | null;
  readonly answeredAt: string | null;
}

interface GrievanceRow {
  readonly id: string;
  readonly text: string;
  readonly state: "open" | "resolved";
  readonly response: string | null;
  readonly resolved_at: string | null;
  readonly created_at: string;
}

/** The client's latest concerns, newest first: every one still open, and those answered within DECISION_SHOWN_DAYS. */
export async function latestGrievances(db: D1Database, personId: string, now: Date): Promise<ShownGrievance[]> {
  const answeredSince = new Date(now.getTime() - DECISION_SHOWN_DAYS * DAY_MS).toISOString();
  const { results } = await db
    .prepare(
      `SELECT id, text, state, response, resolved_at, created_at FROM grievances
       WHERE person_id = ?1 AND (state = 'open' OR resolved_at >= ?2)
       ORDER BY created_at DESC LIMIT ?3`,
    )
    .bind(personId, answeredSince, GRIEVANCES_SHOWN)
    .all<GrievanceRow>();
  return results.map((row) => ({
    id: row.id,
    text: row.text,
    state: row.state,
    raisedAt: row.created_at,
    response: row.response,
    answeredAt: row.resolved_at,
  }));
}

/** The client's concern in these very words that is still open, if there is one. */
export async function openGrievanceInWords(db: D1Database, personId: string, text: string): Promise<string | null> {
  return db
    .prepare("SELECT id FROM grievances WHERE person_id = ?1 AND text = ?2 AND state = 'open'")
    .bind(personId, text)
    .first<string>("id");
}

/**
 * Tells the team chat, in one message, how many concerns raised in the last whole hour (9:00 to 10:00 for a run at
 * 10:24) are still open. Run once an hour, it tells each concern once; Grievances lists every open one, told or not.
 */
export async function tellOfNewGrievances(
  db: D1Database,
  tell: (message: string) => Promise<void>,
  queueLink: string,
  now: Date,
): Promise<number> {
  const until = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  const row = await db
    .prepare("SELECT COUNT(*) AS raised FROM grievances WHERE state = 'open' AND created_at >= ?1 AND created_at < ?2")
    .bind(new Date(until - HOUR_MS).toISOString(), new Date(until).toISOString())
    .first<{ raised: number }>();
  const raised = row?.raised ?? 0;
  if (raised > 0) await tell(newGrievancesMessage(raised, queueLink));
  return raised;
}

function newGrievancesMessage(raised: number, queueLink: string): string {
  if (raised === 1) return `A client raised a grievance in the last hour. Answer it in Grievances: ${queueLink}`;
  return `${String(raised)} grievances were raised in the last hour. Answer them in Grievances: ${queueLink}`;
}
