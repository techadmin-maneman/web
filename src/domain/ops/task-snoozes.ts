// A task snoozed on Tasks (docs/decisions/0303-snoozing-a-task.md): off the board until a moment, then back as it was.
// Keyed as its owner is (./task-owners.ts), by its group, its row's id and its episode, so a new task about the same row
// is not snoozed; snoozing it again moves the moment.

import { auditStatement, type AuditEntry } from "../platform/audit.ts";
import type { TaskKey } from "./task-owners.ts";

/** Keeps the task off the board until `until`, with its audit entry in the same batch. */
export async function snoozeTask(
  db: D1Database,
  task: TaskKey & { readonly episode: string },
  options: { until: Date; by: string; now: Date; audit: AuditEntry },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO task_snoozes (task_group, subject_id, episode, until, snoozed_by, snoozed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (task_group, subject_id) DO UPDATE SET episode = excluded.episode, until = excluded.until,
           snoozed_by = excluded.snoozed_by, snoozed_at = excluded.snoozed_at`,
      )
      .bind(task.group, task.id, task.episode, options.until.toISOString(), options.by, options.now.toISOString()),
    auditStatement(db, options.audit, options.now),
  ]);
}
