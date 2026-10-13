// The reporting copy's statements to Postgres: a night's rows staged as JSON, then each table upserted from them, a row
// stamped only when its values change, and the rows no longer worked out deleted by their keys.

import { describe, expect, it } from "vitest";
import type { TableMeta } from "../../../src/providers/warehouse/index.ts";
import { goneSql, stageSql, upsertSql } from "../../../src/providers/warehouse/supabase.ts";

const squeezed = (sql: string) => sql.replace(/\s+/g, " ").trim();

const meta = (given: Partial<TableMeta> & Pick<TableMeta, "table" | "key" | "columns">): TableMeta => ({
  stamped: true,
  rows: 1,
  amountPaise: null,
  ...given,
});

describe("the reporting copy's statements", () => {
  it("stages a batch as each row's key and its JSON, under the run and the table", () => {
    expect(squeezed(stageSql(2))).toBe(
      'INSERT INTO "analytics"."load_rows" (run_id, table_name, key, row) VALUES ($1, $2, $3, ($4::text)::jsonb), ' +
        "($1, $2, $5, ($6::text)::jsonb)",
    );
  });

  it("upserts a table from what was staged, stamping only a row whose values changed", () => {
    const client = meta({ table: "dim_client", key: ["client_key"], columns: ["client_key", "channel", "referred"] });
    expect(squeezed(upsertSql(client))).toBe(
      'INSERT INTO "analytics"."dim_client" AS t ("client_key", "channel", "referred") ' +
        'SELECT r."client_key", r."channel", r."referred" FROM "analytics"."load_rows" l, ' +
        'jsonb_populate_record(NULL::"analytics"."dim_client", l.row) r WHERE l.run_id = $1 AND l.table_name = $2 ' +
        'ON CONFLICT ("client_key") DO UPDATE SET "channel" = excluded."channel", "referred" = excluded."referred", ' +
        '"updated_at" = now() WHERE (t."channel", t."referred") IS DISTINCT FROM (excluded."channel", excluded."referred") ' +
        "RETURNING 1",
    );
  });

  it("leaves the stamp out of a table reloaded whole, and adds nothing to a row that is all key", () => {
    const city = meta({ table: "dim_city", key: ["city"], columns: ["city", "zone", "served"], stamped: false });
    expect(squeezed(upsertSql(city))).toContain(
      'DO UPDATE SET "zone" = excluded."zone", "served" = excluded."served" WHERE',
    );
    expect(squeezed(upsertSql(meta({ table: "bridge", key: ["a", "b"], columns: ["a", "b"] })))).toContain(
      'ON CONFLICT ("a", "b") DO NOTHING RETURNING 1',
    );
  });

  it("deletes the rows whose keys, joined, the run did not stage", () => {
    expect(squeezed(goneSql(meta({ table: "fact_message_day", key: ["day", "kind"], columns: [] })))).toBe(
      'DELETE FROM "analytics"."fact_message_day" WHERE ("day"::text || \'|\' || "kind"::text) NOT IN ' +
        '(SELECT key FROM "analytics"."load_rows" WHERE run_id = $1 AND table_name = $2)',
    );
  });

  it("keeps the rows before a table's date as an earlier night wrote them", () => {
    const keepBefore = { column: "day", from: "2026-09-20" };
    expect(goneSql(meta({ table: "fact_capacity", key: ["day"], columns: [], keepBefore }))).toMatch(
      /table_name = \$2\) AND "day" >= \$3::date$/,
    );
  });
});
