// How many rows each table holds in an environment's database, the largest first, for when the database nears its
// limit (docs/runbook/cloudflare-plan.md, "D1 growing"). It reads every row once, a small share of Workers Paid's
// allowance, so it is run at a size alert rather than on a schedule. Writes nothing.
//
//   node scripts/ops/table-sizes.ts --env production [--top 20]
//
// Needs wrangler signed in.

import { readdirSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { backupBindings, retried } from "../lib/backup-bindings.ts";
import { migratedTables } from "../lib/schema-doc.ts";

const { values } = parseArgs({ options: { env: { type: "string" }, top: { type: "string", default: "20" } } });
const environment = values.env;
if (environment !== "staging" && environment !== "production") {
  console.error("Name the environment: --env staging or --env production");
  process.exit(2);
}

const tables = migratedTables(
  readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(`migrations/${name}`, "utf8") })),
).map((table) => table.name);

const { db, close } = await backupBindings(environment);
try {
  const answers = await retried(() =>
    db.batch<{ rows: number }>(tables.map((name) => db.prepare(`SELECT COUNT(*) AS rows FROM "${name}"`))),
  );
  const sizes = tables
    .map((name, index) => ({ name, rows: answers[index]?.results[0]?.rows ?? 0 }))
    .sort((a, b) => b.rows - a.rows);
  const total = sizes.reduce((sum, each) => sum + each.rows, 0);
  console.log(`${environment}: ${total.toLocaleString("en-IN")} rows in ${String(tables.length)} tables`);
  for (const { name, rows } of sizes.slice(0, Number(values.top))) {
    console.log(`${rows.toLocaleString("en-IN").padStart(14)}  ${name}`);
  }
} finally {
  await close();
}
