// The zones that group cities, as NCR does, which a grant of staff access may name
// (docs/decisions/0109-console-departments-and-access.md). Admin › Cities adds one, renames it and deletes one nothing
// names; a city is put in it from its own row.

import { failedUniqueOn } from "../../lib/d1-errors.ts";
import { auditStatementIfDeleted, auditStatementWhen, type AuditEntry } from "../platform/audit.ts";

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

/** That nothing names the zone `name`, a bound parameter or a column: no city, stock place, technician or grant. */
const unnamed = (name: string): string =>
  `NOT EXISTS (SELECT 1 FROM cities WHERE zone = ${name})
   AND NOT EXISTS (SELECT 1 FROM stock_places WHERE zone = ${name})
   AND NOT EXISTS (SELECT 1 FROM technicians WHERE zone = ${name})
   AND NOT EXISTS (SELECT 1 FROM staff_grants WHERE geography = 'zone' AND place = ${name})`;

/** The zones nothing names, which may be deleted. */
export async function deletableZones(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare(`SELECT name FROM zones WHERE ${unnamed("zones.name")}`).all<{ name: string }>();
  return results.map((row) => row.name);
}

/**
 * A zone renamed, every row that names it moved to the new name in the same batch: its cities, stock places and
 * technicians, and the staff grants over it. The new name stands first, so nothing ever names a zone that is not there;
 * each move waits on it, so a rename another request beat moves nothing, and its audit entry is written only if it went.
 */
export async function renameZone(
  db: D1Database,
  change: {
    readonly from: string;
    readonly to: string;
    /** Its technicians moved, a statement of dispatch's (../dispatch/technician-roster.ts), which owns them. */
    readonly technicians: D1PreparedStatement;
  },
  audit: Omit<AuditEntry, "action" | "subject">,
  now: Date,
): Promise<"renamed" | ZoneRefusal> {
  const { from, to } = change;
  if (!(await zoneExists(db, from))) return "not_found";
  if (from === to) return "renamed";
  const stands = "AND EXISTS (SELECT 1 FROM zones WHERE name = ?2)";
  const entry: AuditEntry = { ...audit, action: "zone.rename", subject: { kind: "zone", id: to }, detail: { from } };
  try {
    await db.batch([
      // Another zone of exactly the new name fails the batch; one cased otherwise leaves it unwritten.
      db
        .prepare(
          `INSERT INTO zones (name, sort) SELECT ?2, sort FROM zones WHERE name = ?1
           AND NOT EXISTS (SELECT 1 FROM zones WHERE lower(name) = lower(?2) AND name <> ?1)`,
        )
        .bind(from, to),
      db.prepare(`UPDATE cities SET zone = ?2 WHERE zone = ?1 ${stands}`).bind(from, to),
      db.prepare(`UPDATE stock_places SET zone = ?2 WHERE zone = ?1 ${stands}`).bind(from, to),
      change.technicians,
      db.prepare(`UPDATE staff_grants SET place = ?2 WHERE geography = 'zone' AND place = ?1 ${stands}`).bind(from, to),
      db.prepare(`DELETE FROM zones WHERE name = ?1 ${stands}`).bind(from, to),
      auditStatementWhen(db, entry, now, {
        sql: "EXISTS (SELECT 1 FROM zones WHERE name = ?10) AND NOT EXISTS (SELECT 1 FROM zones WHERE name = ?11)",
        binds: [to, from],
      }),
    ]);
  } catch (error) {
    if (!failedUniqueOn(error, "zones")) throw error;
    return "taken";
  }
  if (!(await zoneExists(db, to))) return (await zoneExists(db, from)) ? "taken" : "not_found";
  return "renamed";
}

/** A zone deleted, while nothing names it: no city, stock place, technician or staff grant; audited only if it went. */
export async function deleteZone(
  db: D1Database,
  name: string,
  audit: Omit<AuditEntry, "action" | "subject">,
  now: Date,
): Promise<"deleted" | ZoneRefusal> {
  if (!(await zoneExists(db, name))) return "not_found";
  await db.batch([
    db.prepare(`DELETE FROM zones WHERE name = ?1 AND ${unnamed("?1")}`).bind(name),
    auditStatementIfDeleted(db, { ...audit, action: "zone.delete", subject: { kind: "zone", id: name } }, now, {
      table: "zones",
      column: "name",
      value: name,
    }),
  ]);
  return (await zoneExists(db, name)) ? "in_use" : "deleted";
}
