// Cycle counts' tasks (docs/decisions/0185-cycle-counts.md), raised each morning by ./cycle-counts.ts: the counter is
// shown only what to count, never what the ledger holds. A count within the tolerance goes straight into the ledger;
// past it, it is counted again, and a recount that still differs waits for a manager's sign-off, which is the case it
// makes, with why.

import { classOf, needsRecount, type CountClass } from "../../policy/cycle-counts.ts";
import { auditStatement } from "../ops/audit.ts";
import type { Place } from "./stock-places.ts";
import { count, type Written } from "./stock.ts";

type TaskState = "open" | "recount" | "sign_off" | "done";

export interface CountTask {
  readonly id: string;
  readonly placeId: Place;
  readonly place: string;
  readonly countClass: CountClass;
  readonly dueOn: string;
  readonly state: TaskState;
}

export interface CountItem {
  readonly code: string;
  readonly name: string;
  readonly state: "to_count" | "recount" | "sign_off" | "settled";
}

export interface Difference {
  readonly code: string;
  readonly name: string;
  readonly held: number;
  readonly counted: number;
  readonly recounted: number | null;
}

/** What a step answered: done, or why not. `waiting` counts the lines left for a recount or a sign-off. */
export type Stepped =
  | { readonly ok: true; readonly waiting: number; readonly task: CountTask }
  | { readonly ok: false; readonly missing: true }
  | { readonly ok: false; readonly state: true }
  | { readonly ok: false; readonly fields: string[] };

type TaskRow = {
  id: string;
  place_id: string;
  place: string;
  count_class: CountClass;
  due_on: string;
  state: TaskState;
};

const taskOf = (row: TaskRow): CountTask => ({
  id: row.id,
  placeId: row.place_id,
  place: row.place,
  countClass: row.count_class,
  dueOn: row.due_on,
  state: row.state,
});

/** The tasks still to finish, and those done in the last week, in the places given (null for every place). */
export async function countTasks(
  db: D1Database,
  within: ReadonlySet<Place> | null,
  since: string,
): Promise<CountTask[]> {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.place_id, COALESCE(p.name, k.name) AS place, t.count_class, t.due_on, t.state, 0 AS finished
       FROM count_tasks t INDEXED BY count_tasks_open JOIN stock_places p ON p.id = t.place_id
       LEFT JOIN technicians k ON k.id = p.technician_id
       WHERE t.state <> 'done' AND (p.kind <> 'kit' OR k.id IS NOT NULL)
       UNION ALL
       SELECT t.id, t.place_id, COALESCE(p.name, k.name) AS place, t.count_class, t.due_on, t.state, 1 AS finished
       FROM count_tasks t INDEXED BY count_tasks_done JOIN stock_places p ON p.id = t.place_id
       LEFT JOIN technicians k ON k.id = p.technician_id
       WHERE t.state = 'done' AND t.done_at >= ?1 AND (p.kind <> 'kit' OR k.id IS NOT NULL)
       ORDER BY finished, due_on, place COLLATE NOCASE`,
    )
    .bind(since)
    .all<TaskRow>();
  return results.filter((row) => within === null || within.has(row.place_id)).map(taskOf);
}

export async function countTask(db: D1Database, id: string): Promise<CountTask | null> {
  const row = await db
    .prepare(
      `SELECT t.id, t.place_id, COALESCE(p.name, k.name) AS place, t.count_class, t.due_on, t.state
       FROM count_tasks t JOIN stock_places p ON p.id = t.place_id LEFT JOIN technicians k ON k.id = p.technician_id
       WHERE t.id = ?1 AND (p.kind <> 'kit' OR k.id IS NOT NULL)`,
    )
    .bind(id)
    .first<TaskRow>();
  return row === null ? null : taskOf(row);
}

/** What the place holds of the task's class, which an open task counts. */
async function itemsToCount(db: D1Database, task: CountTask): Promise<{ code: string; name: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT b.consumable_code AS code, i.name FROM stock_balances b INDEXED BY stock_balances_by_place
       JOIN consumables i ON i.code = b.consumable_code LEFT JOIN hair_systems h ON h.code = b.consumable_code
       WHERE b.place = ?1 AND b.quantity > 0
         AND COALESCE(i.count_class, CASE WHEN h.code IS NULL THEN 'quarterly' ELSE 'weekly' END) = ?2
       ORDER BY i.name COLLATE NOCASE`,
    )
    .bind(task.placeId, task.countClass)
    .all<{ code: string; name: string }>();
  return results;
}

/** The task's items and where each stands, without a figure: what an open task counts, or the lines it counted. */
export async function countItems(db: D1Database, task: CountTask): Promise<CountItem[]> {
  if (task.state === "open") {
    return (await itemsToCount(db, task)).map((item) => ({ ...item, state: "to_count" }));
  }
  const { results } = await db
    .prepare(
      `SELECT l.consumable_code AS code, i.name, l.state FROM count_lines l JOIN consumables i ON i.code = l.consumable_code
       WHERE l.task_id = ?1 ORDER BY i.name COLLATE NOCASE`,
    )
    .bind(task.id)
    .all<{ code: string; name: string; state: CountItem["state"] }>();
  return results;
}

/** The lines waiting for a sign-off, each with what the ledger held and both counts: for the manager alone. */
export async function differences(db: D1Database, id: string): Promise<Difference[]> {
  const { results } = await db
    .prepare(
      `SELECT l.consumable_code AS code, i.name, l.held, l.counted, l.recounted
       FROM count_lines l JOIN consumables i ON i.code = l.consumable_code
       WHERE l.task_id = ?1 AND l.state = 'sign_off' ORDER BY i.name COLLATE NOCASE`,
    )
    .bind(id)
    .all<Difference>();
  return results;
}

/** What the place holds of each code, and which of them are hair systems. */
async function heldNow(db: D1Database, place: Place, codes: readonly string[]) {
  const [held, pieces] = await db.batch<{ code: string; quantity: number }>([
    db
      .prepare(
        `SELECT consumable_code AS code, quantity FROM stock_balances
         WHERE place = ?1 AND consumable_code IN (SELECT value FROM json_each(?2))`,
      )
      .bind(place, JSON.stringify(codes)),
    db
      .prepare("SELECT code, 0 AS quantity FROM hair_systems WHERE code IN (SELECT value FROM json_each(?1))")
      .bind(JSON.stringify(codes)),
  ]);
  return {
    held: new Map(
      ((held?.results ?? []) as { code: string; quantity: number }[]).map((row) => [row.code, row.quantity]),
    ),
    pieces: new Set(((pieces?.results ?? []) as { code: string }[]).map((row) => row.code)),
  };
}

const sameCodes = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

const auditOf = (
  written: Written,
  action: "count_task.count" | "count_task.recount" | "count_task.sign_off",
  id: string,
  detail: Record<string, number>,
) => ({
  surface: "ops" as const,
  actor: written.actor,
  action,
  subject: { kind: "count_task", id },
  requestId: written.requestId,
  detail,
});

/** A line the ledger takes: the place set to what was counted. */
async function settle(db: D1Database, task: CountTask, line: { code: string; counted: number }, written: Written) {
  const moved = await count(db, { code: line.code, place: task.placeId, counted: line.counted, note: null }, written);
  if (!moved.ok) throw new Error(`a count task's line for ${line.code} was refused: ${moved.fields.join(", ")}`);
}

/**
 * Claims a task in `state` for one step, by the column only that step writes, so two counts make one; the task, or
 * why not. The claim is let go if the step fails before it is finished.
 */
async function claim(
  db: D1Database,
  { id, state }: { readonly id: string; readonly state: TaskState },
  written: Written,
  step: (task: CountTask) => Promise<Stepped>,
): Promise<Stepped> {
  const task = await countTask(db, id);
  if (task === null) return { ok: false, missing: true };
  if (task.state !== state) return { ok: false, state: true };
  const at = written.now.toISOString();
  const statement = {
    open: "UPDATE count_tasks SET counted_by = ?2, counted_at = ?3 WHERE id = ?1 AND state = 'open' AND counted_at IS NULL",
    recount:
      "UPDATE count_tasks SET recounted_by = ?2, recounted_at = ?3 WHERE id = ?1 AND state = 'recount' AND recounted_at IS NULL",
    sign_off:
      "UPDATE count_tasks SET signed_off_by = ?2, signed_off_at = ?3 WHERE id = ?1 AND state = 'sign_off' AND signed_off_at IS NULL",
  }[state as "open" | "recount" | "sign_off"];
  const claimed = await db.prepare(statement).bind(id, written.actor.id, at).run();
  if (claimed.meta.changes !== 1) return { ok: false, state: true };
  try {
    return await step(task);
  } catch (error) {
    const letGo = {
      open: "UPDATE count_tasks SET counted_by = NULL, counted_at = NULL WHERE id = ?1 AND state = 'open'",
      recount: "UPDATE count_tasks SET recounted_by = NULL, recounted_at = NULL WHERE id = ?1 AND state = 'recount'",
      sign_off:
        "UPDATE count_tasks SET signed_off_by = NULL, signed_off_at = NULL WHERE id = ?1 AND state = 'sign_off'",
    }[state as "open" | "recount" | "sign_off"];
    await db.prepare(letGo).bind(id).run();
    throw error;
  }
}

/** An open task's count, every item it lists, blind: each within the tolerance settled, the rest to count again. */
export async function submitCounts(
  db: D1Database,
  id: string,
  lines: readonly { readonly code: string; readonly counted: number }[],
  written: Written,
): Promise<Stepped> {
  const task = await countTask(db, id);
  if (task?.state === "open") {
    const listed = (await itemsToCount(db, task)).map((item) => item.code);
    if (
      !sameCodes(
        listed,
        lines.map((line) => line.code),
      )
    )
      return { ok: false, fields: ["lines"] };
  }
  return claim(db, { id, state: "open" }, written, async (claimed) => {
    const { held, pieces } = await heldNow(
      db,
      claimed.placeId,
      lines.map((line) => line.code),
    );
    const rows: { code: string; held: number; counted: number; state: "settled" | "recount" }[] = [];
    for (const line of lines) {
      const had = held.get(line.code) ?? 0;
      const again = needsRecount(line.counted, had, pieces.has(line.code));
      if (!again) await settle(db, claimed, line, written);
      rows.push({ code: line.code, held: had, counted: line.counted, state: again ? "recount" : "settled" });
    }
    const waiting = rows.filter((row) => row.state === "recount").length;
    const at = written.now.toISOString();
    await db.batch([
      db
        .prepare(
          `INSERT INTO count_lines (task_id, consumable_code, held, counted, state)
           SELECT ?1, json_extract(value, '$.code'), json_extract(value, '$.held'), json_extract(value, '$.counted'),
             json_extract(value, '$.state')
           FROM json_each(?2)`,
        )
        .bind(id, JSON.stringify(rows)),
      db
        .prepare("UPDATE count_tasks SET state = ?2, done_at = ?3 WHERE id = ?1")
        .bind(id, waiting > 0 ? "recount" : "done", waiting > 0 ? null : at),
      auditStatement(
        db,
        auditOf(written, "count_task.count", id, { lines: rows.length, recounts: waiting }),
        written.now,
      ),
    ]);
    return { ok: true, waiting, task: { ...claimed, state: waiting > 0 ? "recount" : "done" } };
  });
}

/** A task's recount of the lines that differed: each now within the tolerance settled, the rest to sign off. */
export async function submitRecounts(
  db: D1Database,
  id: string,
  lines: readonly { readonly code: string; readonly counted: number }[],
  written: Written,
): Promise<Stepped> {
  const task = await countTask(db, id);
  if (task?.state === "recount") {
    const waiting = (await countItems(db, task)).filter((item) => item.state === "recount").map((item) => item.code);
    if (
      !sameCodes(
        waiting,
        lines.map((line) => line.code),
      )
    )
      return { ok: false, fields: ["lines"] };
  }
  return claim(db, { id, state: "recount" }, written, async (claimed) => {
    const { held, pieces } = await heldNow(
      db,
      claimed.placeId,
      lines.map((line) => line.code),
    );
    const rows: { code: string; recounted: number; state: "settled" | "sign_off" }[] = [];
    for (const line of lines) {
      const stands = needsRecount(line.counted, held.get(line.code) ?? 0, pieces.has(line.code));
      if (!stands) await settle(db, claimed, line, written);
      rows.push({ code: line.code, recounted: line.counted, state: stands ? "sign_off" : "settled" });
    }
    const waiting = rows.filter((row) => row.state === "sign_off").length;
    await db.batch([
      db
        .prepare(
          `UPDATE count_lines SET recounted = json_extract(r.value, '$.recounted'), state = json_extract(r.value, '$.state')
           FROM json_each(?2) r WHERE count_lines.task_id = ?1 AND count_lines.consumable_code = json_extract(r.value, '$.code')`,
        )
        .bind(id, JSON.stringify(rows)),
      db
        .prepare("UPDATE count_tasks SET state = ?2, done_at = ?3 WHERE id = ?1")
        .bind(id, waiting > 0 ? "sign_off" : "done", waiting > 0 ? null : written.now.toISOString()),
      auditStatement(
        db,
        auditOf(written, "count_task.recount", id, { lines: rows.length, differ: waiting }),
        written.now,
      ),
    ]);
    return { ok: true, waiting, task: { ...claimed, state: waiting > 0 ? "sign_off" : "done" } };
  });
}

/** A manager's sign-off, with why: each line that still differed set to its recount, and the task done. */
export async function signOff(db: D1Database, id: string, note: string, written: Written): Promise<Stepped> {
  return claim(db, { id, state: "sign_off" }, written, async (claimed) => {
    const lines = await differences(db, id);
    for (const line of lines)
      await settle(db, claimed, { code: line.code, counted: line.recounted ?? line.counted }, written);
    await db.batch([
      db.prepare("UPDATE count_lines SET state = 'settled' WHERE task_id = ?1 AND state = 'sign_off'").bind(id),
      db
        .prepare("UPDATE count_tasks SET state = 'done', sign_off_note = ?2, done_at = ?3 WHERE id = ?1")
        .bind(id, note, written.now.toISOString()),
      auditStatement(db, auditOf(written, "count_task.sign_off", id, { lines: lines.length }), written.now),
    ]);
    return { ok: true, waiting: 0, task: { ...claimed, state: "done" } };
  });
}

export interface ClassedItem {
  readonly code: string;
  readonly name: string;
  readonly countClass: CountClass;
  /** Whether ops set the class, rather than it being its kind's own. */
  readonly set: boolean;
  readonly hairSystem: boolean;
}

/** Every item not retired, with its class: consumables first, then hair systems, each by name. */
export async function countClasses(db: D1Database): Promise<ClassedItem[]> {
  const { results } = await db
    .prepare(
      `SELECT c.code, c.name, c.count_class, h.code IS NOT NULL AS hair_system
       FROM consumables c LEFT JOIN hair_systems h ON h.code = c.code
       WHERE c.retired_date IS NULL ORDER BY 4, c.name COLLATE NOCASE`,
    )
    .all<{ code: string; name: string; count_class: CountClass | null; hair_system: number }>();
  return results.map((row) => ({
    code: row.code,
    name: row.name,
    countClass: classOf(row.count_class, row.hair_system === 1),
    set: row.count_class !== null,
    hairSystem: row.hair_system === 1,
  }));
}

/** An item's class set, or put back to its kind's own with null. Whether there was such an item. */
export async function setCountClass(
  db: D1Database,
  code: string,
  countClass: CountClass | null,
  written: Written,
): Promise<boolean> {
  const changed = await db
    .prepare("UPDATE consumables SET count_class = ?2 WHERE code = ?1 AND retired_date IS NULL")
    .bind(code, countClass)
    .run();
  if (changed.meta.changes !== 1) return false;
  await auditStatement(
    db,
    {
      surface: "ops",
      actor: written.actor,
      action: "consumable.count_class",
      subject: { kind: "consumable", id: code },
      requestId: written.requestId,
      detail: { count_class: countClass },
    },
    written.now,
  ).run();
  return true;
}
