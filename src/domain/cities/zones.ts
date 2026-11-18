// The zones that group cities, as NCR does, which a grant of staff access may name
// (docs/decisions/0109-console-departments-and-access.md). Admin › Cities adds one; a city is put in it from its own row.

import { auditStatementWhen, type AuditEntry } from "../platform/audit.ts";

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
  // zone it names, and only once, since a zone is never deleted.
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
