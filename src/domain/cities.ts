export interface City {
  readonly name: string;
  readonly served: boolean;
}

/** Active cities in the order the booking form lists them. */
export async function listCities(db: D1Database): Promise<City[]> {
  const { results } = await db
    .prepare("SELECT name, served FROM cities WHERE active = 1 ORDER BY sort, name")
    .all<{ name: string; served: number }>();
  return results.map((row) => ({ name: row.name, served: row.served === 1 }));
}

export async function findActiveCity(db: D1Database, name: string): Promise<City | null> {
  const row = await db
    .prepare("SELECT name, served FROM cities WHERE active = 1 AND name = ?1")
    .bind(name)
    .first<{ name: string; served: number }>();
  return row === null ? null : { name: row.name, served: row.served === 1 };
}
