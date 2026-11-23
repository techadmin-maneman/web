// A task snoozed on Tasks (docs/decisions/0303-snoozing-a-task.md): off the board until a moment, then back as it was.
// Kept to the task it was set on: its group, its row's id, its episode and the moment it started waiting as the board
// read it, so a new task about the same row, a chat the client wrote to again, is not snoozed.

import { auditStatement, type AuditEntry } from "../platform/audit.ts";
import type { TaskKey } from "./task-owners.ts";

interface Snoozed extends TaskKey {
  readonly episode: string;
  /** When the task started waiting, as the board reads it (./tasks.ts' Task.since). */
  readonly since: string;
}

/** The key a snooze and a task on the board share. */
export const snoozeKey = (task: Snoozed): string => `${task.group}|${task.id}|${task.episode}|${task.since}`;

/** Keeps the task off the board until `until`, with its audit entry in the same batch. */
export async function snoozeTask(
  db: D1Database,
  task: Snoozed,
  options: { until: Date; by: string; now: Date; audit: AuditEntry },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO task_snoozes (task_group, subject_id, episode, task_since, until, snoozed_by, snoozed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (task_group, subject_id) DO UPDATE SET episode = excluded.episode,
           task_since = excluded.task_since, until = excluded.until, snoozed_by = excluded.snoozed_by,
           snoozed_at = excluded.snoozed_at`,
      )
      .bind(
        task.group,
        task.id,
        task.episode,
        task.since,
        options.until.toISOString(),
        options.by,
        options.now.toISOString(),
      ),
    auditStatement(db, options.audit, options.now),
  ]);
}

/** The keys of the tasks snoozed until after now. */
export async function snoozedNow(db: D1Database, now: Date): Promise<ReadonlySet<string>> {
  const { results } = await db
    .prepare("SELECT task_group, subject_id, episode, task_since FROM task_snoozes WHERE until > ?1")
    .bind(now.toISOString())
    .all<{ task_group: string; subject_id: string; episode: string; task_since: string }>();
  return new Set(
    results.map((row) =>
      snoozeKey({
        group: row.task_group as TaskKey["group"],
        id: row.subject_id,
        episode: row.episode,
        since: row.task_since,
      }),
    ),
  );
}
