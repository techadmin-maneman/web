export interface City {
  readonly name: string;
  readonly served: boolean;
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

/** Whether a name is one of our active cities, as a technician's city must be. */
export async function isActiveCity(db: D1Database, name: string): Promise<boolean> {
  const found = await db.prepare("SELECT 1 FROM cities WHERE name = ?1 AND active = 1").bind(name).first();
  return found !== null;
}
