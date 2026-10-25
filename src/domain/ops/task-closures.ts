// A task ops closed without doing its thing (docs/decisions/0092-task-owners.md;
// src/policy/tasks.ts): a visit left partly done, whose follow-up the client may
// never want; an at-risk client, with what came of the call; a City matter. The
// closing is kept, with ops' reason and who closed it, by the task's group and its
// row's id; the board then leaves the task out (src/domain/ops/tasks.ts), and a
// later visit left partly done, or a client at risk after a later visit, is a task of its own.

import { auditStatementIfWritten, type AuditEntry } from "../platform/audit.ts";
import type { TaskKey } from "./task-owners.ts";

interface Closing {
  readonly by: string;
  readonly at: string;
  /** Null once the client is erased: ops' words about them go with the rest (src/domain/privacy/erasure.ts). */
  readonly reason: string | null;
}

/**
 * Closes the task, with its audit entry in the same batch. Two members of staff
 * closing it at once close it once: the second writes nothing, and logs nothing.
 */
export async function closeTask(
  db: D1Database,
  task: TaskKey,
  options: { reason: string; by: string; now: Date; audit: AuditEntry },
): Promise<void> {
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO task_closures (id, task_group, subject_id, reason, closed_by, closed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (task_group, subject_id) DO NOTHING`,
      )
      .bind(id, task.group, task.id, options.reason, options.by, options.now.toISOString()),
    auditStatementIfWritten(db, options.audit, options.now, { table: "task_closures", id }),
    // A shortfall checked leaves the open list its task is read from (migration 0198).
    ...(task.group === "consumables_short"
      ? [
          db
            .prepare(
              "UPDATE consumable_shortfalls SET settled_at = ?2 WHERE appointment_id = ?1 AND settled_at IS NULL",
            )
            .bind(task.id, options.now.toISOString()),
        ]
      : []),
  ]);
}

/** How ops closed the visits of these left partly done without a follow-up, by visit. */
export async function partialVisitsClosed(
  db: D1Database,
  appointmentIds: readonly string[],
): Promise<Map<string, Closing>> {
  if (appointmentIds.length === 0) return new Map();
  const placeholders = appointmentIds.map((_, index) => `?${String(index + 1)}`).join(", ");
  const { results } = await db
    .prepare(
      `SELECT subject_id, closed_by, closed_at, reason FROM task_closures
       WHERE task_group = 'partial_visit' AND subject_id IN (${placeholders})`,
    )
    .bind(...appointmentIds)
    .all<{ subject_id: string; closed_by: string; closed_at: string; reason: string | null }>();
  return new Map(
    results.map((row) => [row.subject_id, { by: row.closed_by, at: row.closed_at, reason: row.reason }] as const),
  );
}
