// A real Postgres in this process (PGlite), with the reporting copy's migrations applied (warehouse/migrations): what
// the drift check compares the live schema with, and what the tests run the copy's SQL on.

import { PGlite, type PGliteInterface, type Transaction } from "@electric-sql/pglite";
import { migrate, warehouseMigrations, type Migration, type Postgres } from "./warehouse-migrations.ts";

export function postgresOn(pg: PGliteInterface | Transaction): Postgres {
  return {
    exec: async (sql) => {
      await pg.exec(sql);
    },
    query: async <T>(sql: string, params: readonly unknown[] = []) => (await pg.query<T>(sql, [...params])).rows,
    transaction: async (work) => {
      if (!("transaction" in pg)) throw new Error("a transaction inside a transaction");
      await pg.transaction((tx) => work(postgresOn(tx)));
    },
  };
}

/** A fresh database, with the migrations given, or all of them, applied. */
export async function migratedWarehouse(migrations: readonly Migration[] = warehouseMigrations()): Promise<PGlite> {
  const pg = await PGlite.create();
  await migrate(postgresOn(pg), migrations);
  return pg;
}
