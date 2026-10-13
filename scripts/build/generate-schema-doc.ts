// Writes docs/schema.md, and each table's row type in src/lib/rows.ts, from the migrations (scripts/lib/schema-doc.ts,
// scripts/lib/row-types.ts). Run it after a migration adds or changes a table.
//
//   npm run schema

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { rowTypes } from "../lib/row-types.ts";
import { migratedTables, schemaDoc } from "../lib/schema-doc.ts";

const migrations = readdirSync("migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(`migrations/${name}`, "utf8") }));
const tables = migratedTables(migrations);
writeFileSync("docs/schema.md", schemaDoc(tables));
writeFileSync("src/lib/rows.ts", rowTypes(tables));
console.log(`docs/schema.md: ${String(tables.length)} tables from ${String(migrations.length)} migrations`);
