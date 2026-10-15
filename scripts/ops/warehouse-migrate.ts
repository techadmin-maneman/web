// Applies the reporting copy's migrations (warehouse/migrations) the analytics project has not had, in order, each in
// a transaction, as the postgres login: npm run warehouse:migrate. With --mark-applied <name>, it records the
// migrations up to that one as applied without running them, for a schema made by hand before the files were, and only
// once the schema is what they make. With --pending, it lists what it would apply and applies nothing.
//
// It reads WAREHOUSE_ADMIN_URL from .env.analytics-supabase, which git ignores, and prints no password.

import { parseArgs } from "node:util";
import { adminLogin, postgresAt } from "../lib/analytics-logins.ts";
import { migratedWarehouse, postgresOn } from "../lib/pglite.ts";
import {
  appliedMigrations,
  markApplied,
  migrate,
  schemaShape,
  shapeDiff,
  warehouseMigrations,
} from "../lib/warehouse-migrations.ts";

const { values } = parseArgs({ options: { "mark-applied": { type: "string" }, pending: { type: "boolean" } } });
const migrations = warehouseMigrations();
const db = postgresAt(adminLogin());
try {
  const through = values["mark-applied"];
  if (values.pending === true) {
    const applied = new Set(await appliedMigrations(db));
    const pending = migrations.filter((migration) => !applied.has(migration.name)).map((migration) => migration.name);
    console.log(pending.length === 0 ? "nothing to apply" : `to apply: ${pending.join(", ")}`);
  } else if (through !== undefined) {
    const upTo = migrations.findIndex((migration) => migration.name === through);
    if (upTo < 0) throw new Error(`no migration is named ${through}`);
    const made = await migratedWarehouse(migrations.slice(0, upTo + 1));
    const differences = shapeDiff(await schemaShape(postgresOn(made)), await schemaShape(db));
    if (differences.length > 0) {
      for (const line of differences) console.log(line);
      throw new Error("the schema is not what the migrations make, so none was marked as applied");
    }
    console.log(`marked as applied: ${(await markApplied(db, migrations, through)).join(", ")}`);
  } else {
    const applied = await migrate(db, migrations);
    console.log(applied.length === 0 ? "nothing to apply" : `applied: ${applied.join(", ")}`);
  }
} finally {
  await db.close();
}
