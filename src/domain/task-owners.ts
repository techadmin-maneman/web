// Whose each task on the Tasks board is (docs/decisions/0092-task-owners.md;
// src/policy/tasks.ts). A task is still read from its queue at the moment ops
// look (src/domain/tasks.ts): its owner is kept apart, keyed by the task's group
// and the id of the row it is read from, which no later task reuses.

import { auditStatement, type AuditEntry } from "./audit.ts";
import type { TaskGroup } from "../policy/tasks.ts";

/** A task by what the board names it with: its group, and the id of the row it is read from. */
export interface TaskKey {
  readonly group: TaskGroup;
  readonly id: string;
}

/**
 * The members of staff who have used the console since `since`, by e-mail.
 * There is no staff table: Access says who may sign in, and every call a
 * member of staff makes is logged under the e-mail Access gives
 * (src/http/audit.ts). One who has left stays in the log for ever, so only
 * those seen lately are staff (src/policy/tasks.ts).
 *
 * The log holds every call ever made, so this walks its index of actors one
 * e-mail at a time, each step the first e-mail after the last, and looks up
 * each one's latest call along the same index: it reads a row or two for each
 * member of staff, not one for each call they made.
 */
export async function staffSeenSince(db: D1Database, since: Date): Promise<string[]> {
  const { results } = await db
    .prepare(
      `WITH RECURSIVE staff (email) AS (
         SELECT MIN(actor) FROM audit_log WHERE actor_kind = 'staff'
         UNION ALL
         SELECT (SELECT MIN(actor) FROM audit_log WHERE actor_kind = 'staff' AND actor > staff.email)
           FROM staff WHERE staff.email IS NOT NULL
       )
       SELECT email FROM staff
        WHERE email IS NOT NULL
          AND (SELECT MAX(at) FROM audit_log WHERE actor_kind = 'staff' AND actor = staff.email) >= ?1`,
    )
    .bind(since.toISOString())
    .all<{ email: string }>();
  return results.map((row) => row.email);
}

/** Makes the task `owner`'s for its episode (src/domain/tasks.ts), in place of anyone's before, audited with it. */
export async function assignTask(
  db: D1Database,
  task: TaskKey & { readonly episode: string },
  options: { owner: string; by: string; now: Date; audit: AuditEntry },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO task_owners (task_group, subject_id, episode, owner, assigned_by, assigned_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (task_group, subject_id) DO UPDATE SET episode = excluded.episode, owner = excluded.owner,
           assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at`,
      )
      .bind(task.group, task.id, task.episode, options.owner, options.by, options.now.toISOString()),
    auditStatement(db, options.audit, options.now),
  ]);
}

/** Makes the task nobody's, with its audit entry in the same batch. */
export async function handBackTask(
  db: D1Database,
  task: TaskKey,
  options: { now: Date; audit: AuditEntry },
): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM task_owners WHERE task_group = ?1 AND subject_id = ?2").bind(task.group, task.id),
    auditStatement(db, options.audit, options.now),
  ]);
}
