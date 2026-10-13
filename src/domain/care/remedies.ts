// Remedies (docs/decisions/0143-remedies.md): free service visits Customer Care give a client, with why. Within the
// limit ops set they are granted at once, a grant in the credit ledger; above it they await a Customer Care manager,
// who approves or declines. An approval leaves a note in the client's chat for their Care person to tell them.
// Each step is audited, never with Care's note.

import { DAY_MS } from "../../lib/durations.ts";
import { withinLimit, type RemedyLimit, type RemedyReason } from "../../policy/remedies.ts";
import { grantCredits } from "../money/credits.ts";
import { auditStatement, type AuditAction, type AuditActor } from "../platform/audit.ts";

interface Change {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

export interface Remedy {
  readonly id: string;
  readonly person: { readonly id: string; readonly name: string };
  readonly visits: number;
  readonly reason: RemedyReason;
  readonly note: string | null;
  readonly given_by: string;
  readonly given_at: string;
  readonly state: "given" | "awaiting" | "declined";
}

const audited = (db: D1Database, change: Change, remedy: { action: AuditAction; id: string; visits: number }) =>
  auditStatement(
    db,
    {
      surface: "ops",
      actor: change.actor,
      action: remedy.action,
      subject: { kind: "remedy", id: remedy.id },
      requestId: change.requestId,
      detail: { visits: remedy.visits },
    },
    change.now,
  );

/** Free visits given the client in the limit's days, awaiting ones aside. */
async function givenLately(db: D1Database, personId: string, limit: RemedyLimit, now: Date): Promise<number> {
  const since = new Date(now.getTime() - limit.days * DAY_MS).toISOString();
  const row = await db
    .prepare(
      "SELECT COALESCE(SUM(visits), 0) AS n FROM remedies WHERE person_id = ?1 AND state = 'given' AND given_at >= ?2",
    )
    .bind(personId, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Every remedy awaiting a manager, as the Tasks board reads its queues (src/domain/ops/tasks.ts). */
export const REMEDIES_AWAITING = `SELECT 'remedy_approval' AS "group", r.id AS id, r.person_id AS person_id,
     pe.name AS person_name, r.visits || ' ' || r.reason AS detail,
     json_object('visits', r.visits, 'reason', r.reason) AS facts, r.given_at AS since, NULL AS due_by, '' AS episode
  FROM remedies r JOIN people pe ON pe.id = r.person_id
 WHERE r.state = 'awaiting' AND pe.erased_at IS NULL`;

/** Gives a client free visits: at once within the limit, else awaiting a manager. Null for no such client. */
export async function giveRemedy(
  db: D1Database,
  change: Change & {
    readonly personId: string;
    readonly visits: number;
    readonly reason: RemedyReason;
    readonly note: string;
    readonly limit: RemedyLimit;
  },
): Promise<{ readonly id: string; readonly state: "given" | "awaiting" } | null> {
  const person = await db
    .prepare("SELECT 1 FROM people WHERE id = ?1 AND erased_at IS NULL")
    .bind(change.personId)
    .first();
  if (person === null) return null;
  const given = withinLimit(change.visits, await givenLately(db, change.personId, change.limit, change.now));
  const id = crypto.randomUUID();
  const state = given ? "given" : "awaiting";
  await db.batch([
    db
      .prepare(
        `INSERT INTO remedies (id, person_id, visits, reason, note, given_by, given_at, state)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        id,
        change.personId,
        change.visits,
        change.reason,
        change.note,
        change.actor.id,
        change.now.toISOString(),
        state,
      ),
    ...(given ? [grantRemedy(db, { id, personId: change.personId, visits: change.visits }, change.now)] : []),
    audited(db, change, { action: given ? "remedy.give" : "remedy.ask", id, visits: change.visits }),
  ]);
  return { id, state };
}

const grantRemedy = (db: D1Database, remedy: { id: string; personId: string; visits: number }, now: Date) =>
  grantCredits(db, { personId: remedy.personId, visits: remedy.visits, source: "ops", sourceId: remedy.id, now });

/** The remedies awaiting a manager, and those given or declined in the last 30 days; the latest first. */
export async function listRemedies(db: D1Database, now: Date): Promise<Remedy[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.person_id, p.name, r.visits, r.reason, r.note, r.given_by, r.given_at, r.state
       FROM remedies r JOIN people p ON p.id = r.person_id
       WHERE p.erased_at IS NULL AND (r.state = 'awaiting' OR r.given_at >= ?1)
       ORDER BY r.state = 'awaiting' DESC, r.given_at DESC LIMIT 100`,
    )
    .bind(new Date(now.getTime() - 30 * DAY_MS).toISOString())
    .all<Omit<Remedy, "person"> & { person_id: string; name: string }>();
  return results.map(({ person_id: id, name, ...rest }) => ({ ...rest, person: { id, name } }));
}

/**
 * A manager's answer to a remedy awaiting them: approved, granted and noted in the client's chat; or declined. False
 * for one not awaiting.
 */
export async function decideRemedy(
  db: D1Database,
  change: Change & { readonly id: string; readonly approve: boolean },
): Promise<boolean> {
  const remedy = await db
    .prepare("SELECT person_id, visits FROM remedies WHERE id = ?1 AND state = 'awaiting'")
    .bind(change.id)
    .first<{ person_id: string; visits: number }>();
  if (remedy === null) return false;
  const at = change.now.toISOString();
  await db.batch([
    db
      .prepare("UPDATE remedies SET state = ?2, decided_by = ?3, decided_at = ?4 WHERE id = ?1")
      .bind(change.id, change.approve ? "given" : "declined", change.actor.id, at),
    ...(change.approve
      ? [
          grantRemedy(db, { id: change.id, personId: remedy.person_id, visits: remedy.visits }, change.now),
          // The client's Care person tells them, in their chat.
          db
            .prepare(
              `INSERT INTO chat_messages (id, conversation_id, direction, author, text, sent_at, created_at)
               SELECT ?1, id, 'note', ?2, ?3, ?4, ?4 FROM conversations WHERE person_id = ?5
               ORDER BY last_message_at DESC LIMIT 1`,
            )
            .bind(crypto.randomUUID(), change.actor.id, approvedNote(remedy.visits), at, remedy.person_id),
        ]
      : []),
    audited(db, change, {
      action: change.approve ? "remedy.approve" : "remedy.decline",
      id: change.id,
      visits: remedy.visits,
    }),
  ]);
  return true;
}

/** The note an approval leaves in the client's chat, for their Care person. */
const approvedNote = (visits: number): string =>
  `Approved: ${String(visits)} free service ${visits === 1 ? "visit" : "visits"}, now on their account. Let them know.`;
