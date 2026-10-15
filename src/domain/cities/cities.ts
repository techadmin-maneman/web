// Our cities as the code reads them (docs/decisions/0198-cities-as-data.md): each a row ops add and change at
// Admin › Cities (./city-changes.ts), with its state for GST, its zone, whether we serve it and whether it is offered
// at all.

interface City {
  readonly name: string;
  readonly served: boolean;
}

/** A city as Admin › Cities shows it. */
export interface CityRow {
  readonly name: string;
  /** The state's GST code, as Books names a place of supply: HR. Null for a city whose state is not set yet. */
  readonly state_code: string | null;
  readonly state: string | null;
  readonly zone: string | null;
  readonly served: boolean;
  readonly active: boolean;
  readonly sort: number;
}

/** Active cities in their display order, which the dispatch board filters by and a technician's city is one of. */
export async function listCities(db: D1Database): Promise<City[]> {
  const { results } = await db
    .prepare("SELECT name, served FROM cities WHERE active = 1 ORDER BY sort, name")
    .all<{ name: string; served: number }>();
  return results.map((row) => ({ name: row.name, served: row.served === 1 }));
}

/**
 * The cities the dispatch board can be narrowed to: those we serve, and any other with a technician in it. A city
 * only on the waitlist would give an empty board.
 */
export async function boardCities(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT c.name FROM cities c
       WHERE c.active = 1
         AND (c.served = 1 OR EXISTS (SELECT 1 FROM technicians t WHERE t.city = c.name AND t.active = 1))
       ORDER BY c.sort, c.name`,
    )
    .all<{ name: string }>();
  return results.map((row) => row.name);
}

/**
 * The city of a pincode served now marked served too, so Cities, the filters and the pincodes say one thing: a city is
 * served once any pincode of it is.
 */
export const cityServedWith = (db: D1Database, pincode: string): D1PreparedStatement =>
  db
    .prepare(
      "UPDATE cities SET served = 1 WHERE served = 0 AND name = (SELECT city FROM serviceable_pincodes WHERE pincode = ?1)",
    )
    .bind(pincode);

/**
 * The cities Clients may be narrowed to, within `reach` (a JSON list of names, or null for every city): those marked
 * served, and any with a pincode served whatever it is marked.
 */
export async function clientCities(db: D1Database, reach: string | null): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT name FROM cities c
       WHERE (served = 1 OR EXISTS (SELECT 1 FROM serviceable_pincodes p WHERE p.city = c.name AND p.served = 1))
         AND (?1 IS NULL OR name IN (SELECT value FROM json_each(?1))) ORDER BY name`,
    )
    .bind(reach)
    .all<{ name: string }>();
  return results.map((row) => row.name);
}

/** Whether a name is one of our active cities, as a technician's city must be. */
export async function isActiveCity(db: D1Database, name: string): Promise<boolean> {
  const found = await db.prepare("SELECT 1 FROM cities WHERE name = ?1 AND active = 1").bind(name).first();
  return found !== null;
}

type Stored = Omit<CityRow, "served" | "active"> & { readonly served: number; readonly active: number };

const COLUMNS = "name, state_code, state, zone, served, active, sort";
const rowOf = (row: Stored): CityRow => ({ ...row, served: row.served === 1, active: row.active === 1 });

/** Every city, offered or not, in the order ops gave them. */
export async function allCities(db: D1Database): Promise<CityRow[]> {
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM cities ORDER BY sort, name`).all<Stored>();
  return results.map(rowOf);
}

export async function cityNamed(db: D1Database, name: string): Promise<CityRow | null> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM cities WHERE name = ?1`).bind(name).first<Stored>();
  return row === null ? null : rowOf(row);
}

/** Each city's state, by its name, for a pass that reads many: a Books pass, say. */
export async function cityStates(db: D1Database): Promise<ReadonlyMap<string, { code: string; name: string }>> {
  const { results } = await db
    .prepare("SELECT name, state_code, state FROM cities WHERE state_code IS NOT NULL AND state IS NOT NULL")
    .all<{ name: string; state_code: string; state: string }>();
  return new Map(results.map((row) => [row.name, { code: row.state_code, name: row.state }]));
}

/** The city a visit is in, which its price and its rules are read for; null for one with none named. */
export async function cityOfVisit(db: D1Database, visitId: string): Promise<string | null> {
  const row = await db.prepare("SELECT service_city FROM appointments WHERE id = ?1").bind(visitId).first<{
    service_city: string | null;
  }>();
  return row?.service_city ?? null;
}

/** The city a pincode we hold is in; null for one we do not. */
export async function cityOfPincode(db: D1Database, pincode: string | null): Promise<string | null> {
  if (pincode === null) return null;
  const row = await db
    .prepare("SELECT city FROM serviceable_pincodes WHERE pincode = ?1")
    .bind(pincode)
    .first<{ city: string }>();
  return row?.city ?? null;
}

/** The city a client lives in: their saved address's pincode's, else the address's own; null with no address. */
export async function cityOfPerson(db: D1Database, personId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT COALESCE(p.city, d.city) AS city FROM addresses d
       LEFT JOIN serviceable_pincodes p ON p.pincode = d.pincode
       WHERE d.person_id = ?1 AND d.replaced_at IS NULL ORDER BY d.created_at DESC LIMIT 1`,
    )
    .bind(personId)
    .first<{ city: string | null }>();
  return row?.city ?? null;
}
