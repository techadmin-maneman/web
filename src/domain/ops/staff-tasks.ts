// Tasks ops write themselves on Tasks (docs/decisions/0302-tasks-written-by-hand.md): what needs doing, the department
// it is for, the client it is about if any, and when it is due. The board reads the open ones, one group a department
// (./task-queues.ts), so each department's people see their own; one written for someone is theirs at once
// (./task-owners.ts), and one marked done leaves the board.

import { DEPARTMENTS, type Department } from "../../policy/access.ts";
import type { TaskGroup } from "../../policy/tasks.ts";
import { auditStatement, auditStatementIfStamped, type AuditEntry } from "../platform/audit.ts";
import type { Queue } from "./task-queues.ts";

/** The board's group for a department's tasks written by hand. */
export const staffTaskGroup = (department: Department): TaskGroup => `staff_task_${department}`;

/**
 * Each department's open tasks, the words as written as the task's detail, waiting since they were written and due
 * when their writer said (./tasks.ts' dueOf). One about a client since erased is gone with them; one about nobody
 * stays.
 */
export const STAFF_TASK_QUEUES: readonly Queue[] = DEPARTMENTS.map((department) => ({
  group: staffTaskGroup(department),
  sql: `SELECT '${staffTaskGroup(department)}' AS "group", st.id AS id, st.person_id AS person_id,
       pe.name AS person_name, st.what AS detail, json_object() AS facts, st.created_at AS since,
       st.due_at AS due_by, '' AS episode
    FROM staff_tasks st LEFT JOIN people pe ON pe.id = st.person_id
   WHERE st.done_at IS NULL AND st.department = '${department}' AND (st.person_id IS NULL OR pe.erased_at IS NULL)`,
}));

export interface StaffTask {
  readonly what: string;
  readonly department: Department;
  /** The client it is about; null for none. */
  readonly personId: string | null;
  /** Where it is, for a task about no client: the city it was written in; null for every city. */
  readonly city: string | null;
  readonly dueAt: Date;
  /** The member of staff it is theirs from the start, by their Access e-mail; null for nobody yet. */
  readonly owner: string | null;
}

/** Writes the task, and its owner where it has one, with its audit entry, in one batch. Its id. */
export async function writeStaffTask(
  db: D1Database,
  task: StaffTask,
  options: { by: string; now: Date; audit: Omit<AuditEntry, "subject"> },
): Promise<string> {
  const id = crypto.randomUUID();
  const at = options.now.toISOString();
  const owner =
    task.owner === null
      ? []
      : [
          db
            .prepare(
              `INSERT INTO task_owners (task_group, subject_id, episode, owner, assigned_by, assigned_at)
               VALUES (?1, ?2, '', ?3, ?4, ?5)`,
            )
            .bind(staffTaskGroup(task.department), id, task.owner, options.by, at),
        ];
  await db.batch([
    db
      .prepare(
        `INSERT INTO staff_tasks (id, department, what, person_id, city, due_at, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(id, task.department, task.what, task.personId, task.city, task.dueAt.toISOString(), options.by, at),
    ...owner,
    auditStatement(db, { ...options.audit, subject: { kind: "task", id } }, options.now),
  ]);
  return id;
}

/** The department an open task is for; null where there is no such task open. */
export async function openStaffTask(db: D1Database, id: string): Promise<Department | null> {
  const row = await db
    .prepare("SELECT department FROM staff_tasks WHERE id = ?1 AND done_at IS NULL")
    .bind(id)
    .first<{ department: Department }>();
  return row?.department ?? null;
}

/** Marks the task done, its audit entry written only when it was still open. Whether it was. */
export async function markStaffTaskDone(
  db: D1Database,
  id: string,
  options: { by: string; now: Date; audit: AuditEntry },
): Promise<boolean> {
  const at = options.now.toISOString();
  const [done] = await db.batch([
    db
      .prepare("UPDATE staff_tasks SET done_at = ?2, done_by = ?3 WHERE id = ?1 AND done_at IS NULL")
      .bind(id, at, options.by),
    auditStatementIfStamped(db, options.audit, options.now, { table: "staff_tasks", column: "done_at", id }),
  ]);
  return (done?.meta.changes ?? 0) === 1;
}

/** Whether the client is one a task may be about: there, and not erased. */
export async function clientToWriteAbout(db: D1Database, id: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM people WHERE id = ?1 AND erased_at IS NULL").bind(id).first()) !== null;
}

/** Whether a city of that name is one the business has. */
export async function cityKnown(db: D1Database, name: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM cities WHERE name = ?1").bind(name).first()) !== null;
}
