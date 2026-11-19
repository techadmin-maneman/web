// The points a hair system is checked against as it arrives (docs/decisions/0169-supplier-claims.md), as rows ops
// add, rename and switch off at Settings › Purchasing, and delete while no claim names one
// (docs/decisions/0283-changed-and-deleted-while-unused.md). A claim keeps their names as they read when it was drafted.

import { auditStatementIfDeleted, auditStatementWhen, type AuditEntry } from "../platform/audit.ts";

export interface QcPoint {
  readonly id: string;
  readonly name: string;
  /** Whether each hair system that arrives is checked against it. */
  readonly checked: boolean;
  /** Whether no claim names it, so it may be deleted. */
  readonly deletable: boolean;
}

type Audit = Omit<AuditEntry, "action" | "subject" | "detail">;

/** That no claim names the point `id`, a bound parameter or a column. */
const unclaimed = (id: string): string =>
  `NOT EXISTS (SELECT 1 FROM supplier_claims k, json_each(k.failed_points) j WHERE j.value = ${id})`;

/** That no other point goes by the name `name`, however cased. */
const nameFree = (name: string, id: string): string =>
  `NOT EXISTS (SELECT 1 FROM qc_points o WHERE lower(o.name) = lower(${name}) AND o.id <> ${id})`;

/** Every point, in order, checked or not, and whether a claim names it. */
export async function qcPoints(db: D1Database): Promise<QcPoint[]> {
  const { results } = await db
    .prepare(`SELECT id, name, checked, ${unclaimed("qc_points.id")} AS deletable FROM qc_points ORDER BY sort, name`)
    .all<{ id: string; name: string; checked: number; deletable: number }>();
  return results.map((row) => ({ ...row, checked: row.checked === 1, deletable: row.deletable === 1 }));
}

/** The points each hair system that arrives is checked against, in order, as a receipt names them. */
export async function checkedPoints(db: D1Database): Promise<{ id: string; name: string }[]> {
  const { results } = await db
    .prepare("SELECT id, name FROM qc_points WHERE checked = 1 ORDER BY sort, name")
    .all<{ id: string; name: string }>();
  return results;
}

/** A point added, checked, last in the order; its audit entry only if it went in. */
export async function addQcPoint(db: D1Database, name: string, audit: Audit, now: Date): Promise<QcPoint | "taken"> {
  const id = crypto.randomUUID();
  const [added] = await db.batch([
    db
      .prepare(
        `INSERT INTO qc_points (id, name, sort, checked)
         SELECT ?1, ?2, (SELECT COALESCE(MAX(sort), 0) + 10 FROM qc_points), 1 WHERE ${nameFree("?2", "?1")}`,
      )
      .bind(id, name),
    auditStatementWhen(db, { ...audit, action: "qc_point.add", subject: { kind: "qc_point", id } }, now, {
      sql: "EXISTS (SELECT 1 FROM qc_points WHERE id = ?10)",
      binds: [id],
    }),
  ]);
  return added?.meta.changes === 1 ? { id, name, checked: true, deletable: true } : "taken";
}

/** A point renamed, or switched on or off; claims already drafted keep the name they read. */
export async function changeQcPoint(
  db: D1Database,
  change: { readonly id: string; readonly name: string; readonly checked: boolean },
  audit: Audit,
  now: Date,
): Promise<QcPoint | "taken" | "not_found"> {
  const { id } = change;
  const entry: AuditEntry = {
    ...audit,
    action: "qc_point.change",
    subject: { kind: "qc_point", id },
    detail: { checked: change.checked },
  };
  const [changed] = await db.batch([
    db
      .prepare(`UPDATE qc_points SET name = ?2, checked = ?3 WHERE id = ?1 AND ${nameFree("?2", "?1")}`)
      .bind(id, change.name, change.checked ? 1 : 0),
    auditStatementWhen(db, entry, now, {
      sql: "EXISTS (SELECT 1 FROM qc_points WHERE id = ?10 AND name = ?11 AND checked = ?12)",
      binds: [id, change.name, change.checked ? 1 : 0],
    }),
  ]);
  const point = (await qcPoints(db)).find((each) => each.id === id);
  if (point === undefined) return "not_found";
  return changed?.meta.changes === 1 ? point : "taken";
}

/** A point deleted while no claim names it; its audit entry only if it went. */
export async function deleteQcPoint(
  db: D1Database,
  id: string,
  audit: Audit,
  now: Date,
): Promise<"deleted" | "in_use" | "not_found"> {
  const there = async () => (await db.prepare("SELECT 1 FROM qc_points WHERE id = ?1").bind(id).first()) !== null;
  if (!(await there())) return "not_found";
  await db.batch([
    db.prepare(`DELETE FROM qc_points WHERE id = ?1 AND ${unclaimed("?1")}`).bind(id),
    auditStatementIfDeleted(db, { ...audit, action: "qc_point.delete", subject: { kind: "qc_point", id } }, now, {
      table: "qc_points",
      column: "id",
      value: id,
    }),
  ]);
  return (await there()) ? "in_use" : "deleted";
}
