export interface City {
  readonly name: string;
  readonly served: boolean;
}

/** Active cities in their display order, which the dispatch board filters by. */
export async function listCities(db: D1Database): Promise<City[]> {
  const { results } = await db
    .prepare("SELECT name, served FROM cities WHERE active = 1 ORDER BY sort, name")
    .all<{ name: string; served: number }>();
  return results.map((row) => ({ name: row.name, served: row.served === 1 }));
}
