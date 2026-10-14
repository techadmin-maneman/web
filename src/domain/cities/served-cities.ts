// The cities the public site says it comes to: each with a pincode ops serve, in the console's order, and the areas
// served in each, A to Z (src/routes/public/served-cities.ts).

export interface ServedCities {
  readonly cities: string[];
  readonly areas: Record<string, string[]>;
}

export async function servedCities(db: D1Database): Promise<ServedCities> {
  const [cities, areas] = await db.batch<{ city: string; area: string }>([
    db.prepare(
      `SELECT p.city FROM serviceable_pincodes p LEFT JOIN cities k ON k.name = p.city
       WHERE p.served = 1
       GROUP BY p.city ORDER BY MIN(COALESCE(k.sort, 1000)), p.city`,
    ),
    db.prepare("SELECT DISTINCT city, area FROM serviceable_pincodes WHERE served = 1 ORDER BY city, area"),
  ]);
  const byCity: Record<string, string[]> = {};
  for (const row of areas?.results ?? []) (byCity[row.city] ??= []).push(row.area);
  return { cities: (cities?.results ?? []).map((row) => row.city), areas: byCity };
}
