// Whether the analytics project's schema is what warehouse/migrations make: each table's columns, their types, whether
// they may be empty, their defaults, and each table's key, read as the copy's writer and compared with a database built
// from the files in this process. Exits 1 on any difference, which a migration should then make good:
// npm run warehouse:check.

import { analyticsLogin, postgresAt } from "../lib/analytics-logins.ts";
import { migratedWarehouse, postgresOn } from "../lib/pglite.ts";
import { schemaShape, shapeDiff } from "../lib/warehouse-migrations.ts";

const migrated = await schemaShape(postgresOn(await migratedWarehouse()));

const live = postgresAt(analyticsLogin("analytics_writer"));
try {
  const differences = shapeDiff(migrated, await schemaShape(live));
  for (const line of differences) console.log(line);
  console.log(
    differences.length === 0
      ? `the analytics schema is what the migrations make (${String(migrated.length)} columns and keys)`
      : `${String(differences.length)} differences`,
  );
  if (differences.length > 0) process.exitCode = 1;
} finally {
  await live.close();
}
