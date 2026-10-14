// A client's concerns about how we use their data: the ones their profile shows them, one message an hour to the
// team chat about new ones, and the WhatsApp that tells the client ops have answered.

import { DAY_MS, HOUR_MS } from "../../lib/durations.ts";
import { firstNameOf } from "../../lib/names.ts";
import { queueMessage } from "../messages/queued-messages.ts";
import type { Composed } from "../messages/visit-message-text.ts";
import { DECISION_SHOWN_DAYS } from "../../policy/decision-reasons.ts";
import { GRIEVANCES_SHOWN } from "../../policy/grievances.ts";
import type { PlacesReached } from "../../policy/access.ts";
import { reachBinding, withinReach } from "../clients/places.ts";
import { auditStatement, opsEntry, type Written } from "../platform/audit.ts";

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
  tell: (message: string) => Promise<unknown>,
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

/** The message that tells the client their concern is answered; for the batch that records the answer. */
export function concernAnsweredMessage(
  db: D1Database,
  input: { readonly grievanceId: string; readonly personId: string; readonly now: Date },
): { id: string; statement: D1PreparedStatement } {
  const id = crypto.randomUUID();
  const statement = queueMessage(db, {
    id,
    personId: input.personId,
    kind: "concern_answered",
    subject: { kind: "grievance", id: input.grievanceId },
    at: input.now.toISOString(),
  });
  return { id, statement };
}

/**
 * What a queued answer says: the client's first name, and where to read the answer. It answers the client's own
 * concern, so it goes whatever they chose about visit messages.
 */
export async function composeConcernAnswered(db: D1Database, grievanceId: string, personId: string): Promise<Composed> {
  const row = await db
    .prepare(
      `SELECT p.name FROM grievances g JOIN people p ON p.id = g.person_id
       WHERE g.id = ?1 AND g.person_id = ?2 AND g.state = 'resolved'`,
    )
    .bind(grievanceId, personId)
    .first<{ name: string }>();
  if (row === null) return { skip: "the concern was not answered" };
  return { template: "concern_answered_v1", params: [firstNameOf(row.name)] };
}

/** A concern still open, as the console lists it. */
export interface OpenGrievance {
  readonly id: string;
  readonly person_id: string;
  readonly name: string;
  readonly mobile_e164: string;
  readonly text: string;
  readonly created_at: string;
}

/** The concerns still open in the caller's places, the oldest first, up to `limit`. */
export async function openGrievances(db: D1Database, reached: PlacesReached, limit: number): Promise<OpenGrievance[]> {
  const { results } = await db
    .prepare(
      `SELECT g.id, g.person_id, p.name, p.mobile_e164, g.text, g.created_at FROM grievances g
       JOIN people p ON p.id = g.person_id
       WHERE g.state = 'open' AND p.erased_at IS NULL AND ${withinReach("grievance", "g", "?1")}
       ORDER BY g.created_at LIMIT ?2`,
    )
    .bind(reachBinding(reached), limit)
    .all<OpenGrievance>();
  return results;
}

/**
 * Ops' answer to a concern still open: written with its audit entry and the client's message, together or not at all
 * (src/domain/platform/audit.ts). The message to queue; null for a concern not open.
 */
export async function resolveGrievance(
  db: D1Database,
  answer: { readonly id: string; readonly response: string },
  written: Written,
): Promise<string | null> {
  const open = await db
    .prepare("SELECT person_id FROM grievances WHERE id = ?1 AND state = 'open'")
    .bind(answer.id)
    .first<{ person_id: string }>();
  if (open === null) return null;
  const now = written.now;
  const told = concernAnsweredMessage(db, { grievanceId: answer.id, personId: open.person_id, now });
  await db.batch([
    db
      .prepare(
        `UPDATE grievances SET state = 'resolved', response = ?2, resolved_by = ?3, resolved_at = ?4
         WHERE id = ?1 AND state = 'open'`,
      )
      .bind(answer.id, answer.response, written.actor.id, now.toISOString()),
    auditStatement(db, opsEntry(written, "grievance.resolve", { kind: "grievance", id: answer.id }), now),
    told.statement,
  ]);
  return told.id;
}
