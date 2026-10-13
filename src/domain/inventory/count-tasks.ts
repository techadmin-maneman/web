// Cycle counts' tasks (docs/decisions/0185-cycle-counts.md), raised each morning by ./cycle-counts.ts: the counter is
// shown only what to count, never what the ledger holds. A count within the tolerance goes straight into the ledger;
// past it, it is counted again, and a recount that still differs waits for a manager's sign-off, which is the case it
// makes, with why.

import { needsRecount, type CountClass, type CycleCounts } from "../../policy/cycle-counts.ts";
import { auditStatement } from "../platform/audit.ts";
import { labelColumns, labelFields, labelsFound, labelsHeld, labelsOf, type CountedLine } from "./count-labels.ts";
import type { Place } from "./stock-places.ts";
import { count, type Written } from "./stock.ts";

type TaskState = "open" | "recount" | "sign_off" | "done";

export interface CountTask {
  readonly id: string;
  readonly placeId: Place;
  readonly place: string;
  /** A task of one item ops started, by its code and name; null on the morning's tasks of a class. */
  readonly item: { readonly code: string; readonly name: string } | null;
  readonly countClass: CountClass;
  readonly dueOn: string;
  readonly state: TaskState;
}

export interface CountItem {
  readonly code: string;
  readonly name: string;
  readonly state: "to_count" | "recount" | "sign_off" | "settled";
  /** Whether the place holds it under labels, which are scanned to count it. */
  readonly labelled: boolean;
  /** Labels the latest count scanned that the place does not hold, for ops to look into. */
  readonly unknown: readonly string[];
}

export interface Difference {
  readonly code: string;
  readonly name: string;
  readonly held: number;
  readonly counted: number;
  readonly recounted: number | null;
  /** The labels the latest count scanned; absent on a line counted by number. */
  readonly labels: readonly string[] | undefined;
  /** Labels held there and not scanned, and labels scanned and not held there; empty on a line counted by number. */
  readonly missing: readonly string[];
  readonly unknown: readonly string[];
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
  consumable_code: string | null;
  item: string | null;
  count_class: CountClass;
  due_on: string;
  state: TaskState;
};

const taskOf = (row: TaskRow): CountTask => ({
  id: row.id,
  placeId: row.place_id,
  place: row.place,
  item: row.consumable_code === null ? null : { code: row.consumable_code, name: row.item ?? row.consumable_code },
  countClass: row.count_class,
  dueOn: row.due_on,
  state: row.state,
});

const TASK_COLUMNS =
  "t.id, t.place_id, COALESCE(p.name, k.name) AS place, t.consumable_code, i.name AS item, t.count_class, t.due_on, t.state";

/** The tasks still to finish, and those done in the last week, in the places given (null for every place). */
export async function countTasks(
  db: D1Database,
  within: ReadonlySet<Place> | null,
  since: string,
): Promise<CountTask[]> {
  const { results } = await db
    .prepare(
      `SELECT ${TASK_COLUMNS}, 0 AS finished
       FROM count_tasks t INDEXED BY count_tasks_open JOIN stock_places p ON p.id = t.place_id
       LEFT JOIN technicians k ON k.id = p.technician_id LEFT JOIN consumables i ON i.code = t.consumable_code
       WHERE t.state <> 'done' AND (p.kind <> 'kit' OR k.id IS NOT NULL)
       UNION ALL
       SELECT ${TASK_COLUMNS}, 1 AS finished
       FROM count_tasks t INDEXED BY count_tasks_done JOIN stock_places p ON p.id = t.place_id
       LEFT JOIN technicians k ON k.id = p.technician_id LEFT JOIN consumables i ON i.code = t.consumable_code
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
      `SELECT ${TASK_COLUMNS}
       FROM count_tasks t JOIN stock_places p ON p.id = t.place_id LEFT JOIN technicians k ON k.id = p.technician_id
         LEFT JOIN consumables i ON i.code = t.consumable_code
       WHERE t.id = ?1 AND (p.kind <> 'kit' OR k.id IS NOT NULL)`,
    )
    .bind(id)
    .first<TaskRow>();
  return row === null ? null : taskOf(row);
}

/** What the place holds of the task's class, or its one item, which an open task counts. */
async function itemsToCount(
  db: D1Database,
  task: CountTask,
): Promise<{ code: string; name: string; labelled: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT b.consumable_code AS code, i.name,
         EXISTS (SELECT 1 FROM stock_units u INDEXED BY stock_units_held
                 WHERE u.place = b.place AND u.consumable_code = b.consumable_code AND u.state = 'held') AS labelled
       FROM stock_balances b INDEXED BY stock_balances_by_place
       JOIN consumables i ON i.code = b.consumable_code LEFT JOIN hair_systems h ON h.code = b.consumable_code
       WHERE b.place = ?1 AND b.quantity > 0
         AND COALESCE(i.count_class, CASE WHEN h.code IS NULL THEN 'quarterly' ELSE 'weekly' END) = ?2
         AND (?3 IS NULL OR b.consumable_code = ?3)
       ORDER BY i.name COLLATE NOCASE`,
    )
    .bind(task.placeId, task.countClass, task.item?.code ?? null)
    .all<{ code: string; name: string; labelled: number }>();
  return results;
}

/** The task's items and where each stands, without a figure: what an open task counts, or the lines it counted. */
export async function countItems(db: D1Database, task: CountTask): Promise<CountItem[]> {
  if (task.state === "open") {
    return (await itemsToCount(db, task)).map((item) => ({
      code: item.code,
      name: item.name,
      state: "to_count",
      labelled: item.labelled === 1,
      unknown: [],
    }));
  }
  const { results } = await db
    .prepare(
      `SELECT l.consumable_code AS code, i.name, l.state, l.labels, l.unknown_labels
       FROM count_lines l JOIN consumables i ON i.code = l.consumable_code
       WHERE l.task_id = ?1 ORDER BY i.name COLLATE NOCASE`,
    )
    .bind(task.id)
    .all<LineRow>();
  return results.map((row) => ({
    code: row.code,
    name: row.name,
    state: row.state,
    labelled: row.labels !== null,
    unknown: labelsOf(row.unknown_labels),
  }));
}

type LineRow = {
  code: string;
  name: string;
  state: CountItem["state"];
  labels: string | null;
  unknown_labels: string | null;
};

/** The lines waiting for a sign-off, each with what the ledger held and both counts: for the manager alone. */
export async function differences(db: D1Database, id: string): Promise<Difference[]> {
  const { results } = await db
    .prepare(
      `SELECT l.consumable_code AS code, i.name, l.held, l.counted, l.recounted, l.labels, l.missing_labels,
         l.unknown_labels
       FROM count_lines l JOIN consumables i ON i.code = l.consumable_code
       WHERE l.task_id = ?1 AND l.state = 'sign_off' ORDER BY i.name COLLATE NOCASE`,
    )
    .bind(id)
    .all<DifferenceRow>();
  return results.map((row) => ({
    code: row.code,
    name: row.name,
    held: row.held,
    counted: row.counted,
    recounted: row.recounted,
    labels: row.labels === null ? undefined : labelsOf(row.labels),
    missing: labelsOf(row.missing_labels),
    unknown: labelsOf(row.unknown_labels),
  }));
}

type DifferenceRow = Pick<Difference, "code" | "name" | "held" | "counted" | "recounted"> & {
  labels: string | null;
  missing_labels: string | null;
  unknown_labels: string | null;
};

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

/** A line the ledger takes: the place set to what was counted, the labels held there and not scanned gone missing. */
async function settle(db: D1Database, task: CountTask, line: CountedLine, written: Written) {
  const missing =
    line.labels === undefined
      ? []
      : labelsFound((await labelsHeld(db, task.placeId, [line.code])).get(line.code), line.labels).missing;
  const counted = { code: line.code, place: task.placeId, counted: line.counted, note: null, missing };
  const moved = await count(db, counted, written);
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

/** What a step was sent: each line, and the tolerance a difference is held to. */
interface Sent {
  readonly lines: readonly CountedLine[];
  readonly counts: CycleCounts;
}

/**
 * The lines held up against what the place holds: each line's labels found, and whether it differs, past the
 * tolerance or by a label not scanned or not held there.
 */
async function linesFound(db: D1Database, place: Place, sent: Sent) {
  const codes = sent.lines.map((line) => line.code);
  const [{ held, pieces }, labelled] = await Promise.all([heldNow(db, place, codes), labelsHeld(db, place, codes)]);
  return sent.lines.map((line) => {
    const had = held.get(line.code) ?? 0;
    const found = line.labels === undefined ? null : labelsFound(labelled.get(line.code), line.labels);
    const byLabel = found !== null && (found.missing.length > 0 || found.unknown.length > 0);
    return {
      line,
      had,
      found,
      differs: byLabel || needsRecount(line.counted, had, pieces.has(line.code), sent.counts),
    };
  });
}

/** Why the lines sent are not the step's: not every item it counts, or labels wrong for the place. */
async function linesRefused(db: D1Database, task: CountTask, codes: readonly string[], lines: readonly CountedLine[]) {
  if (
    !sameCodes(
      codes,
      lines.map((line) => line.code),
    )
  )
    return ["lines"];
  return labelFields(lines, await labelsHeld(db, task.placeId, codes));
}

/** An open task's count, every item it lists, blind: each within the tolerance settled, the rest to count again. */
export async function submitCounts(db: D1Database, id: string, sent: Sent, written: Written): Promise<Stepped> {
  const task = await countTask(db, id);
  if (task?.state === "open") {
    const refused = await linesRefused(
      db,
      task,
      (await itemsToCount(db, task)).map((item) => item.code),
      sent.lines,
    );
    if (refused.length > 0) return { ok: false, fields: refused };
  }
  return claim(db, { id, state: "open" }, written, async (claimed) => {
    const rows = [];
    for (const { line, had, found, differs } of await linesFound(db, claimed.placeId, sent)) {
      if (!differs) await settle(db, claimed, line, written);
      const kept = labelColumns(line, found);
      rows.push({ code: line.code, held: had, counted: line.counted, state: differs ? "recount" : "settled", ...kept });
    }
    const waiting = rows.filter((row) => row.state === "recount").length;
    const at = written.now.toISOString();
    await db.batch([
      db
        .prepare(
          `INSERT INTO count_lines (task_id, consumable_code, held, counted, state, labels, missing_labels, unknown_labels)
           SELECT ?1, json_extract(value, '$.code'), json_extract(value, '$.held'), json_extract(value, '$.counted'),
             json_extract(value, '$.state'), json_extract(value, '$.labels'), json_extract(value, '$.missing'),
             json_extract(value, '$.unknown')
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
export async function submitRecounts(db: D1Database, id: string, sent: Sent, written: Written): Promise<Stepped> {
  const task = await countTask(db, id);
  if (task?.state === "recount") {
    const waiting = (await countItems(db, task)).filter((item) => item.state === "recount").map((item) => item.code);
    const refused = await linesRefused(db, task, waiting, sent.lines);
    if (refused.length > 0) return { ok: false, fields: refused };
  }
  return claim(db, { id, state: "recount" }, written, async (claimed) => {
    const rows = [];
    for (const { line, found, differs } of await linesFound(db, claimed.placeId, sent)) {
      if (!differs) await settle(db, claimed, line, written);
      rows.push({
        code: line.code,
        recounted: line.counted,
        state: differs ? "sign_off" : "settled",
        ...labelColumns(line, found),
      });
    }
    const waiting = rows.filter((row) => row.state === "sign_off").length;
    await db.batch([
      db
        .prepare(
          `UPDATE count_lines SET recounted = json_extract(r.value, '$.recounted'),
             state = json_extract(r.value, '$.state'), labels = json_extract(r.value, '$.labels'),
             missing_labels = json_extract(r.value, '$.missing'), unknown_labels = json_extract(r.value, '$.unknown')
           FROM json_each(?2) r
           WHERE count_lines.task_id = ?1 AND count_lines.consumable_code = json_extract(r.value, '$.code')`,
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
    for (const line of lines) {
      await settle(
        db,
        claimed,
        { code: line.code, counted: line.recounted ?? line.counted, labels: line.labels },
        written,
      );
    }
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
