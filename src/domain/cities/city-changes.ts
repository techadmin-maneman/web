// A city added or changed at Admin › Cities (docs/decisions/0198-cities-as-data.md), each change audited in its batch.
// A city's name is its key, so a rename moves every row that names it, in one batch. The console alone writes here,
// which no job imports.

import { auditStatement, type AuditEntry } from "../platform/audit.ts";
import { cityNamed, type CityRow } from "./cities.ts";

/** What a city is set to: all of it, as a new city is added, or as a change leaves it. */
export interface CityFields {
  readonly name: string;
  readonly stateCode: string;
  readonly state: string;
  readonly zone: string | null;
  readonly served: boolean;
  readonly active: boolean;
}

/** Every column that names a city, which a rename moves. A grant of staff access names one as its place. */
export const CITY_COLUMNS: readonly (readonly [table: string, column: string])[] = [
  ["addresses", "city"],
  ["appointments", "service_city"],
  ["city_blackouts", "city"],
  ["city_matters", "city"],
  ["city_prices", "city"],
  ["city_settings", "city"],
  ["demand_events", "city"],
  ["forecast_accuracy", "city"],
  ["forecast_lines", "city"],
  ["leads", "city"],
  ["plan_lines", "city"],
  ["serviceable_pincodes", "city"],
  ["spend_entries", "city"],
  ["stock_places", "city"],
  ["stock_risks", "city"],
  ["targets", "city"],
  ["task_spans", "city"],
  ["technicians", "city"],
  ["visit_pay_rates", "city"],
];

/** Why a city cannot be written: its name is another city's, or its zone is none of ours. */
export type CityRefusal = "held" | "unknown_zone" | "not_found";

async function refusalOf(
  db: D1Database,
  fields: CityFields,
  was: string | null,
): Promise<Exclude<CityRefusal, "not_found"> | null> {
  if (fields.name !== was && (await cityNamed(db, fields.name)) !== null) return "held";
  if (fields.zone === null) return null;
  const zone = await db.prepare("SELECT 1 FROM zones WHERE name = ?1").bind(fields.zone).first();
  return zone === null ? "unknown_zone" : null;
}

/** A city added, last in the order, with its audit entry in the same batch. */
export async function addCity(
  db: D1Database,
  fields: CityFields,
  audit: Omit<AuditEntry, "action" | "subject">,
  now: Date,
): Promise<CityRow | Exclude<CityRefusal, "not_found">> {
  const refusal = await refusalOf(db, fields, null);
  if (refusal !== null) return refusal;
  await db.batch([
    db
      .prepare(
        `INSERT INTO cities (name, state_code, state, zone, served, active, sort)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT COALESCE(MAX(sort), 0) + 10 FROM cities))`,
      )
      .bind(fields.name, fields.stateCode, fields.state, fields.zone, Number(fields.served), Number(fields.active)),
    auditStatement(db, { ...audit, action: "city.add", subject: { kind: "city", id: fields.name } }, now),
  ]);
  const added = await cityNamed(db, fields.name);
  if (added === null) throw new Error("the city added is not there");
  return added;
}

/**
 * A rename's statements: the city under its new name first, then every row that names it, then the old row, so no
 * reference is ever left without its city.
 */
function renamed(db: D1Database, from: string, to: string): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO cities (name, state_code, state, zone, served, active, sort)
         SELECT ?2, state_code, state, zone, served, active, sort FROM cities WHERE name = ?1`,
      )
      .bind(from, to),
    ...CITY_COLUMNS.map(([table, column]) =>
      db.prepare(`UPDATE ${table} SET ${column} = ?2 WHERE ${column} = ?1`).bind(from, to),
    ),
    db.prepare("UPDATE staff_grants SET place = ?2 WHERE geography = 'city' AND place = ?1").bind(from, to),
    db.prepare("DELETE FROM cities WHERE name = ?1").bind(from),
  ];
}

/** A city changed, renamed too where its name changed, with its audit entry in the same batch. */
export async function changeCity(
  db: D1Database,
  { was, fields }: { readonly was: string; readonly fields: CityFields },
  audit: Omit<AuditEntry, "action" | "subject">,
  now: Date,
): Promise<CityRow | CityRefusal> {
  if ((await cityNamed(db, was)) === null) return "not_found";
  const refusal = await refusalOf(db, fields, was);
  if (refusal !== null) return refusal;
  const rename = fields.name === was ? [] : renamed(db, was, fields.name);
  await db.batch([
    ...rename,
    db
      .prepare(`UPDATE cities SET state_code = ?2, state = ?3, zone = ?4, served = ?5, active = ?6 WHERE name = ?1`)
      .bind(fields.name, fields.stateCode, fields.state, fields.zone, Number(fields.served), Number(fields.active)),
    auditStatement(
      db,
      {
        ...audit,
        action: fields.name === was ? "city.change" : "city.rename",
        subject: { kind: "city", id: fields.name },
        detail: fields.name === was ? {} : { from: was },
      },
      now,
    ),
  ]);
  return (await cityNamed(db, fields.name)) ?? "not_found";
}
