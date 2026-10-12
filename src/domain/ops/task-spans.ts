// Each task's span (docs/decisions/0147-task-spans.md): each night the cron reads the Tasks board, opens a span for each
// task it has not seen, from the task's own start, and closes the span of each it no longer finds. The reporting copy
// counts Care cases opened and closed from them.

import { clientCityOf } from "../clients/places.ts";
import type { Task } from "./tasks.ts";

/** New spans a night, in one statement; any more open the night after, each from its own start. */
const SPANS_PER_RUN = 500;

/** A grievance is counted from its own table, which holds every one since the first. */
const COUNTED_ELSEWHERE: ReadonlySet<string> = new Set(["grievance"]);

const field = (name: string) => `json_extract(t.value, '$.${name}')`;

/** Each new task, as a JSON list, with the client's city; none for a record marked as a test. */
const OPEN = `INSERT INTO task_spans (id, task_group, subject_id, episode, city, opened_at)
  SELECT ${field("id")}, ${field("group")}, ${field("subject")}, ${field("episode")},
    (SELECT ${clientCityOf("client")} FROM people client WHERE client.id = ${field("person")}), ${field("since")}
  FROM json_each(?1) t
  WHERE NOT EXISTS (SELECT 1 FROM people tester WHERE tester.id = ${field("person")} AND tester.test_record = 1)
  ON CONFLICT DO NOTHING`;

interface OpenSpan {
  readonly id: string;
  readonly task_group: string;
  readonly subject_id: string;
  readonly episode: string;
}

const identity = (group: string, subject: string, episode: string) => `${group}|${subject}|${episode}`;

/**
 * Brings the spans up to the board. A board cut short at its read cap may be missing tasks still open, so then no span
 * is closed.
 */
export async function recordTaskSpans(
  db: D1Database,
  board: { readonly tasks: readonly Task[]; readonly truncated: boolean },
  now: Date,
): Promise<{ readonly opened: number; readonly closed: number }> {
  const { results: open } = await db
    .prepare("SELECT id, task_group, subject_id, episode FROM task_spans WHERE closed_at IS NULL")
    .all<OpenSpan>();
  const held = new Set(open.map((span) => identity(span.task_group, span.subject_id, span.episode)));
  const tasks = board.tasks.filter((task) => !COUNTED_ELSEWHERE.has(task.group));
  const onBoard = new Set(tasks.map((task) => identity(task.group, task.id, task.episode)));

  const fresh = tasks.filter((task) => !held.has(identity(task.group, task.id, task.episode))).slice(0, SPANS_PER_RUN);
  const gone = board.truncated
    ? []
    : open.filter((span) => !onBoard.has(identity(span.task_group, span.subject_id, span.episode)));
  const statements: D1PreparedStatement[] = [];
  if (fresh.length > 0) {
    const spans = fresh.map((task) => ({
      id: crypto.randomUUID(),
      group: task.group,
      subject: task.id,
      episode: task.episode,
      person: task.person?.id ?? null,
      since: task.since,
    }));
    statements.push(db.prepare(OPEN).bind(JSON.stringify(spans)));
  }
  if (gone.length > 0) {
    statements.push(
      db
        .prepare("UPDATE task_spans SET closed_at = ?1 WHERE id IN (SELECT value FROM json_each(?2))")
        .bind(now.toISOString(), JSON.stringify(gone.map((span) => span.id))),
    );
  }
  if (statements.length > 0) await db.batch(statements);
  return { opened: fresh.length, closed: gone.length };
}
