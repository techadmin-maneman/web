// The reporting copy's statements to Postgres: a row upserted and stamped only when its values change, and the rows
// no longer worked out deleted by their keys.

import { describe, expect, it } from "vitest";
import { staleSql, upsertSql } from "../../../src/providers/warehouse/supabase.ts";

const squeezed = (sql: string) => sql.replace(/\s+/g, " ").trim();

describe("the reporting copy's statements", () => {
  it("upserts a batch, stamping only a row whose values changed", () => {
    const client = { table: "dim_client", key: ["client_key"], stamped: true };
    expect(squeezed(upsertSql(client, ["client_key", "channel", "referred"], 2))).toBe(
      'INSERT INTO "analytics"."dim_client" AS t ("client_key", "channel", "referred") VALUES ($1, $2, $3), ($4, $5, $6) ' +
        'ON CONFLICT ("client_key") DO UPDATE SET "channel" = excluded."channel", "referred" = excluded."referred", ' +
        '"updated_at" = now() WHERE (t."channel", t."referred") IS DISTINCT FROM (excluded."channel", excluded."referred") ' +
        "RETURNING 1",
    );
  });

  it("leaves the stamp out of a table reloaded whole", () => {
    const city = { table: "dim_city", key: ["city"], stamped: false };
    expect(squeezed(upsertSql(city, ["city", "zone", "served"], 1))).toContain(
      'DO UPDATE SET "zone" = excluded."zone", "served" = excluded."served" WHERE',
    );
  });

  it("deletes the rows whose keys, joined, are not tonight's", () => {
    expect(staleSql({ table: "fact_message_day", key: ["day", "kind"], stamped: true })).toBe(
      'DELETE FROM "analytics"."fact_message_day" WHERE NOT (("day"::text || \'|\' || "kind"::text) = ANY($1::text[]))',
    );
  });

  it("keeps the rows before a table's date as an earlier night wrote them", () => {
    const keepBefore = { column: "day", from: "2026-09-20" };
    expect(staleSql({ table: "fact_capacity", key: ["day"], stamped: true, keepBefore })).toMatch(
      /= ANY\(\$1::text\[\]\)\) AND "day" >= \$2::date$/,
    );
  });
});
