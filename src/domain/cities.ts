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

/** Whether a name is one of our active cities, as a technician's city must be. */
export async function isActiveCity(db: D1Database, name: string): Promise<boolean> {
  const found = await db.prepare("SELECT 1 FROM cities WHERE name = ?1 AND active = 1").bind(name).first();
  return found !== null;
}
