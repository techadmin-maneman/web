// Writes this database's identity row, then reads it back and fails if it
// names a different database. Safe to run repeatedly: the row is written once
// and can never change. Run after migrations.
//
// With --check it only reads the row. The deploy workflows run that before
// migrating, so a config naming the wrong database stops before any migration
// reaches it.
//
//   node scripts/mark-database.ts local
//   node scripts/mark-database.ts staging       (remote; uses your wrangler login or CLOUDFLARE_API_TOKEN)
//   node scripts/mark-database.ts production --check
//
// See docs/decisions/0003-environment-identity-guard.md.

import { execFileSync } from "node:child_process";
import { z } from "zod";
import { EXPECTED_DATABASE_NAME, isEnvironmentName } from "../src/config/environments.ts";
import { retryingLostReplies } from "./lib/cloudflare-api.ts";

const environment = process.argv[2];
const checkOnly = process.argv[3] === "--check";
if (!isEnvironmentName(environment)) {
  console.error("usage: node scripts/mark-database.ts <local|staging|production> [--check]");
  process.exit(2);
}

const databaseName = EXPECTED_DATABASE_NAME[environment];

// Locally, wrangler finds the database by binding name; remotely, by database name and environment.
const wranglerTarget =
  environment === "local" ? ["DB", "--local", "--env="] : [databaseName, "--remote", "--env", environment];

/** What `wrangler d1 execute --json` prints for a SELECT. */
const QueryOutput = z.array(z.object({ results: z.array(z.object({ database_name: z.string() })) }));

function runSql(sql: string): unknown {
  const output = retryingLostReplies("database identity", () =>
    execFileSync(
      process.execPath,
      ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", ...wranglerTarget, "--json", "--command", sql],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    ),
  );
  return JSON.parse(output);
}

// databaseName comes from EXPECTED_DATABASE_NAME, never from input, so building the SQL string is safe.
if (!checkOnly) {
  runSql(
    `INSERT INTO deployment_identity (id, database_name) VALUES (1, '${databaseName}') ON CONFLICT(id) DO NOTHING`,
  );
}

const [query] = QueryOutput.parse(runSql("SELECT database_name FROM deployment_identity WHERE id = 1"));
const markedAs = query?.results[0]?.database_name ?? null;

if (markedAs !== databaseName) {
  console.error(
    `identity mismatch: ${environment} expects "${databaseName}", database is marked ${JSON.stringify(markedAs)}`,
  );
  process.exit(1);
}
console.log(`database identity ok: ${environment} -> ${databaseName}`);
