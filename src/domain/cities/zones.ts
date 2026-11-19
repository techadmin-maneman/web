// The zones that group cities, as NCR does, which a grant of staff access may name
// (docs/decisions/0109-console-departments-and-access.md). Admin › Cities adds one, renames it and deletes one nothing
// names; a city is put in it from its own row.

import { auditStatement, auditStatementWhen, type AuditEntry } from "../platform/audit.ts";

/** The zones, in their order. */
export async function zoneNames(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare("SELECT name FROM zones ORDER BY sort, name").all<{ name: string }>();
  return results.map((row) => row.name);
}

/** A zone added, last in the order, with its audit entry; "taken" where a zone goes by that name, however cased. */
export async function addZone(
  db: D1Database,
  name: string,
  audit: Omit<AuditEntry, "action" | "subject">,
  now: Date,
): Promise<"added" | "taken"> {
  const taken = await db.prepare("SELECT 1 FROM zones WHERE lower(name) = lower(?1)").bind(name).first();
  if (taken !== null) return "taken";
  // Another added at the same moment, however cased, leaves this one unwritten: its entry is written only for the
  // zone it names, and only once for that name.
  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO zones (name, sort) SELECT ?1, (SELECT COALESCE(MAX(sort), 0) + 10 FROM zones)
         WHERE NOT EXISTS (SELECT 1 FROM zones WHERE lower(name) = lower(?1))`,
      )
      .bind(name),
    auditStatementWhen(db, { ...audit, action: "zone.add", subject: { kind: "zone", id: name } }, now, {
      sql: `EXISTS (SELECT 1 FROM zones WHERE name = ?10) AND NOT EXISTS (
              SELECT 1 FROM audit_log WHERE subject_kind = 'zone' AND subject_id = ?10 AND action = 'zone.add')`,
      binds: [name],
    }),
  ]);
  return inserted?.meta.changes === 1 ? "added" : "taken";
}

/** Why a zone is not renamed or deleted: none goes by its name, another goes by the new one, or something names it. */
export type ZoneRefusal = "not_found" | "taken" | "in_use";

const zoneExists = async (db: D1Database, name: string): Promise<boolean> =>
  (await db.prepare("SELECT 1 FROM zones WHERE name = ?1").bind(name).first()) !== null;

/** How many rows name the zone: its cities, stock places and technicians, and the staff grants over it. */
async function namedBy(db: D1Database, name: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM cities WHERE zone = ?1) + (SELECT COUNT(*) FROM stock_places WHERE zone = ?1)
            + (SELECT COUNT(*) FROM technicians WHERE zone = ?1)
            + (SELECT COUNT(*) FROM staff_grants WHERE geography = 'zone' AND place = ?1) AS n`,
    )
    .bind(name)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * A zone renamed, every row that names it moved to the new name in the same batch: its cities, stock places and
 * technicians, and the staff grants over it. The new name stands first, so nothing ever names a zone that is not there.
 */
export async function renameZone(
  db: D1Database,
  change: { readonly from: string; readonly to: string },
  audit: Omit<AuditEntry, "action" | "subject">,
  now: Date,
): Promise<"renamed" | ZoneRefusal> {
  const { from, to } = change;
  if (!(await zoneExists(db, from))) return "not_found";
  if (from === to) return "renamed";
  const taken = await db
    .prepare("SELECT 1 FROM zones WHERE lower(name) = lower(?1) AND name <> ?2")
    .bind(to, from)
    .first();
  if (taken !== null) return "taken";
  await db.batch([
    db.prepare("INSERT INTO zones (name, sort) SELECT ?2, sort FROM zones WHERE name = ?1").bind(from, to),
    db.prepare("UPDATE cities SET zone = ?2 WHERE zone = ?1").bind(from, to),
    db.prepare("UPDATE stock_places SET zone = ?2 WHERE zone = ?1").bind(from, to),
    db.prepare("UPDATE technicians SET zone = ?2 WHERE zone = ?1").bind(from, to),
    db.prepare("UPDATE staff_grants SET place = ?2 WHERE geography = 'zone' AND place = ?1").bind(from, to),
    db.prepare("DELETE FROM zones WHERE name = ?1").bind(from),
    auditStatement(db, { ...audit, action: "zone.rename", subject: { kind: "zone", id: to }, detail: { from } }, now),
  ]);
  return "renamed";
}

/** A zone deleted, while nothing names it: no city, stock place, technician or staff grant. */
export async function deleteZone(
  db: D1Database,
  name: string,
  audit: Omit<AuditEntry, "action" | "subject">,
  now: Date,
): Promise<"deleted" | ZoneRefusal> {
  if (!(await zoneExists(db, name))) return "not_found";
  if ((await namedBy(db, name)) > 0) return "in_use";
  await db.batch([
    db.prepare("DELETE FROM zones WHERE name = ?1").bind(name),
    auditStatement(db, { ...audit, action: "zone.delete", subject: { kind: "zone", id: name } }, now),
  ]);
  return "deleted";
}
