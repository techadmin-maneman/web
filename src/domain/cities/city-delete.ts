// A city deleted at Admin › Cities while nothing names it but its own settings
// (docs/decisions/0283-changed-and-deleted-while-unused.md): its prices, rules, blackouts and pay rates go with it.
// One that a client, visit, pincode, technician, stock or staff access names is switched off or hidden instead.

import { auditStatementIfDeleted, type AuditEntry } from "../platform/audit.ts";
import { CITY_COLUMNS } from "./city-changes.ts";

/** The rows that are the city's own settings, which go when it does. */
const OWN: ReadonlySet<string> = new Set(["city_blackouts", "city_prices", "city_settings", "visit_pay_rates"]);

/** That nothing but its own settings names the city `name`, a bound parameter or a column. */
const unused = (name: string): string =>
  [
    ...CITY_COLUMNS.filter(([table]) => !OWN.has(table)).map(
      ([table, column]) => `NOT EXISTS (SELECT 1 FROM ${table} WHERE ${column} = ${name})`,
    ),
    `NOT EXISTS (SELECT 1 FROM staff_grants WHERE geography = 'city' AND place = ${name})`,
  ].join(" AND ");

/** The cities nothing but their own settings names, which may be deleted. */
export async function deletableCities(db: D1Database): Promise<ReadonlySet<string>> {
  const { results } = await db
    .prepare(`SELECT name FROM cities WHERE ${unused("cities.name")}`)
    .all<{ name: string }>();
  return new Set(results.map((row) => row.name));
}

/** A city deleted, its own settings with it, while nothing else names it; its audit entry only if it went. */
export async function deleteCity(
  db: D1Database,
  name: string,
  audit: Omit<AuditEntry, "action" | "subject">,
  now: Date,
): Promise<"deleted" | "in_use" | "not_found"> {
  const there = async () => (await db.prepare("SELECT 1 FROM cities WHERE name = ?1").bind(name).first()) !== null;
  if (!(await there())) return "not_found";
  await db.batch([
    ...[...OWN].map((table) => db.prepare(`DELETE FROM ${table} WHERE city = ?1 AND ${unused("?1")}`).bind(name)),
    db.prepare(`DELETE FROM cities WHERE name = ?1 AND ${unused("?1")}`).bind(name),
    auditStatementIfDeleted(db, { ...audit, action: "city.delete", subject: { kind: "city", id: name } }, now, {
      table: "cities",
      column: "name",
      value: name,
    }),
  ]);
  return (await there()) ? "in_use" : "deleted";
}
