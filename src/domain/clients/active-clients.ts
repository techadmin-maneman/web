// How many active clients a city, a package or a pincode has, as Settings' tables count them (docs/decisions/
// 0313-the-settings-screens-to-the-22-november-redesign.md): a client whose stage is active (./client-stage.ts), never
// one erased or a test record. A client's city is their pincode's.

import { stageSql, type StageDays } from "./client-stage.ts";

/** What a count is by: the client's city (their pincode's), their package, or their pincode. */
export type CountedBy = "city" | "package" | "pincode";

const KEY: Readonly<Record<CountedBy, string>> = {
  city: "(SELECT s.city FROM serviceable_pincodes s WHERE s.pincode = client.pincode)",
  package: "client.package",
  pincode: "client.pincode",
};

/** Each city's, package's or pincode's active clients, by its name or code; one with none is not listed. */
export async function activeClientsBy(
  db: D1Database,
  by: CountedBy,
  days: StageDays,
): Promise<ReadonlyMap<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT ${KEY[by]} AS key, COUNT(*) AS clients FROM people client
       WHERE client.erased_at IS NULL AND client.test_record = 0 AND ${stageSql("client", "?1", "?2")} = 'active'
       GROUP BY key HAVING key IS NOT NULL`,
    )
    .bind(days.grace, days.today)
    .all<{ key: string; clients: number }>();
  return new Map(results.map((row) => [row.key, row.clients]));
}
