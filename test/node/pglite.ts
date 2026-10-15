// The copy's writer's client (src/providers/warehouse/supabase.ts), as the postgres package would be one, over an
// in-process Postgres made from the migrations (scripts/lib/pglite.ts).

import type { PGliteInterface, Transaction } from "@electric-sql/pglite";
import type { Sql } from "../../src/providers/warehouse/supabase.ts";

const rowsOf = async (pg: PGliteInterface | Transaction, query: string, params: readonly unknown[] = []) =>
  (await pg.query<Record<string, unknown>>(query, [...params])).rows;

export function sqlOn(pg: PGliteInterface): Sql {
  return {
    unsafe: (query, params) => rowsOf(pg, query, params),
    begin: async (work) => pg.transaction((tx) => work({ unsafe: (query, params) => rowsOf(tx, query, params) })),
    end: () => Promise.resolve(),
  };
}
