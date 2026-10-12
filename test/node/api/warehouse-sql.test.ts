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
    expect(staleSql("fact_capacity", ["day", "technician_key"])).toBe(
      'DELETE FROM "analytics"."fact_capacity" WHERE NOT (("day"::text || \'|\' || "technician_key"::text) = ANY($1::text[]))',
    );
  });
});
