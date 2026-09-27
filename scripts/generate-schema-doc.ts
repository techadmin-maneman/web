// Writes docs/schema.md from the migrations (scripts/lib/schema-doc.ts). Run it
// after a migration adds or changes a table.
//
//   npm run schema

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { migratedTables, schemaDoc } from "./lib/schema-doc.ts";

const migrations = readdirSync("migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(`migrations/${name}`, "utf8") }));
const tables = migratedTables(migrations);
writeFileSync("docs/schema.md", schemaDoc(tables));
console.log(`docs/schema.md: ${String(tables.length)} tables from ${String(migrations.length)} migrations`);
