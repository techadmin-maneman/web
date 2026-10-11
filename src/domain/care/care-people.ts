// Each client's named Care person (docs/decisions/0131-care-people.md): the Care team are the active staff with a
// national Customer Care grant of Act or Manage; a client is given, at their first chat, the one with the fewest
// clients, and a Customer Care manager can move a client to another. Each move is audited.

import { auditStatement, type AuditActor } from "../ops/audit.ts";

/** The Care team, by e-mail: active staff with a national Customer Care grant that can answer, Act or Manage. */
const CARE_TEAM = `SELECT s.email FROM staff s
  WHERE s.active = 1 AND EXISTS (
    SELECT 1 FROM staff_grants g WHERE g.email = s.email AND g.department = 'customer_care'
      AND g.level IN ('act', 'manage') AND g.geography = 'national')`;

export interface CareMember {
  readonly email: string;
  readonly clients: number;
}

/** The Care team, each with how many clients are theirs, the fewest first. */
export async function careTeam(db: D1Database): Promise<CareMember[]> {
  const { results } = await db
    .prepare(
      `SELECT t.email, (SELECT COUNT(*) FROM care_owners o WHERE o.email = t.email) AS clients
       FROM (${CARE_TEAM}) t ORDER BY clients, t.email`,
    )
    .all<CareMember>();
  return results;
}

/**
 * Gives a client with no Care person the Care team member with the fewest clients, as at their first chat. Nothing
 * where they have one already, or the team is empty: their chats then wait for whoever is on shift.
 */
export async function giveCarePerson(db: D1Database, personId: string, now: Date): Promise<void> {
  await db
    .prepare(
      `INSERT INTO care_owners (person_id, email, since, assigned_by)
       SELECT ?1, t.email, ?2, 'system' FROM (${CARE_TEAM}) t
       ORDER BY (SELECT COUNT(*) FROM care_owners o WHERE o.email = t.email), t.email LIMIT 1
       ON CONFLICT (person_id) DO NOTHING`,
    )
    .bind(personId, now.toISOString())
    .run();
}

/** Moves a client to another member of the Care team, as a Customer Care manager does. */
export async function moveCarePerson(
  db: D1Database,
  move: {
    readonly personId: string;
    readonly email: string;
    readonly actor: AuditActor;
    readonly requestId: string;
    readonly now: Date;
  },
): Promise<"moved" | "not_found" | "not_care"> {
  const person = await db
    .prepare("SELECT 1 FROM people WHERE id = ?1 AND erased_at IS NULL")
    .bind(move.personId)
    .first();
  if (person === null) return "not_found";
  const member = await db.prepare(`SELECT email FROM (${CARE_TEAM}) WHERE email = ?1`).bind(move.email).first();
  if (member === null) return "not_care";
  const at = move.now.toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO care_owners (person_id, email, since, assigned_by) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (person_id) DO UPDATE SET email = excluded.email, since = excluded.since,
           assigned_by = excluded.assigned_by`,
      )
      .bind(move.personId, move.email, at, move.actor.id),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: move.actor,
        action: "care_person.move",
        subject: { kind: "person", id: move.personId },
        requestId: move.requestId,
        detail: { to: move.email },
      },
      move.now,
    ),
  ]);
  return "moved";
}
