// Writes this database's identity row (once; the row is immutable), then reads
// it back and fails if it names a different database. Run after migrations.
//
//   node scripts/mark-database.ts local
//   node scripts/mark-database.ts staging      (remote; needs CLOUDFLARE_API_TOKEN)
//   node scripts/mark-database.ts production
//
// See docs/decisions/0003-environment-identity-guard.md.

import { execFileSync } from "node:child_process";
import { z } from "zod";
import { EXPECTED_DATABASE_NAME, isEnvironmentName } from "../src/config/environments.ts";

const environment = process.argv[2];
if (!isEnvironmentName(environment)) {
  console.error("usage: node scripts/mark-database.ts <local|staging|production>");
  process.exit(2);
}

const databaseName = EXPECTED_DATABASE_NAME[environment];
const target = environment === "local" ? ["DB", "--local"] : [databaseName, "--remote", "--env", environment];

function d1(sql: string): unknown {
  const out = execFileSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", ...target, "--json", "--command", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  return JSON.parse(out);
}

// databaseName comes from a fixed table, never from input, so interpolation is safe.
d1(`INSERT INTO deployment_identity (id, database_name) VALUES (1, '${databaseName}') ON CONFLICT(id) DO NOTHING`);

const ExecuteOutput = z.array(z.object({ results: z.array(z.object({ database_name: z.string() })) }));
const found = ExecuteOutput.parse(d1("SELECT database_name FROM deployment_identity WHERE id = 1"))[0]?.results[0]
  ?.database_name;

if (found !== databaseName) {
  console.error(
    `identity mismatch: ${environment} expects "${databaseName}", database is marked ${JSON.stringify(found ?? null)}`,
  );
  process.exit(1);
}
console.log(`database identity ok: ${environment} -> ${databaseName}`);
