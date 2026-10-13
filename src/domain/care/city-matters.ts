// A matter Customer Care send to a client's city (docs/decisions/0135-city-matters.md): one central team answers every
// chat, and what needs the city, a technician's visit or a word with the city team, goes there as a City matter on
// Tasks (src/domain/ops/tasks.ts). The city closes it with what was done, as a closable task. Each one sent is audited.

import { cityOf } from "../clients/places.ts";
import { auditStatement, type AuditActor } from "../ops/audit.ts";

/** Every City matter not yet closed, as the board reads its queues; the note is its detail. */
export const CITY_MATTERS_OPEN = `SELECT 'city_matter' AS "group", m.id AS id, m.person_id AS person_id,
     pe.name AS person_name, m.note AS detail, json_object('note', m.note) AS facts, m.raised_at AS since, NULL AS due_by, '' AS episode
  FROM city_matters m JOIN people pe ON pe.id = m.person_id
 WHERE pe.erased_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM task_closures c WHERE c.task_group = 'city_matter' AND c.subject_id = m.id)`;

/** Sends a matter from a chat to its client's city; refused for a number we don't know, or a client with no city. */
export async function raiseCityMatter(
  db: D1Database,
  matter: {
    readonly conversationId: string;
    readonly note: string;
    readonly actor: AuditActor;
    readonly requestId: string;
    readonly now: Date;
  },
): Promise<{ readonly city: string } | "not_found" | "no_city"> {
  const chat = await db
    .prepare(
      `SELECT c.person_id FROM conversations c JOIN people p ON p.id = c.person_id
       WHERE c.id = ?1 AND p.erased_at IS NULL`,
    )
    .bind(matter.conversationId)
    .first<{ person_id: string }>();
  if (chat === null) return "not_found";
  const city = await cityOf(db, "client", chat.person_id);
  if (city === null) return "no_city";
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO city_matters (id, person_id, conversation_id, city, note, raised_by, raised_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(id, chat.person_id, matter.conversationId, city, matter.note, matter.actor.id, matter.now.toISOString()),
    // The note is Care's words about the client, kept with the matter and never in the log.
    auditStatement(
      db,
      {
        surface: "ops",
        actor: matter.actor,
        action: "city_matter.raise",
        subject: { kind: "person", id: chat.person_id },
        requestId: matter.requestId,
        detail: { city },
      },
      matter.now,
    ),
  ]);
  return { city };
}
