// Loads data/pincodes/india-pincodes.csv into pincode_directory, India Post's pincodes ops choose ours from
// (data/pincodes/README.md). Safe to run again: each pincode's row is replaced by the file's, and a pincode the file
// no longer lists stays, since a client's address may still name it. Run after migrations, and after each quarter's
// fetch-pincode-directory.ts.
//
//   node scripts/ops/load-pincode-directory.ts <local|staging|production>

import { readFileSync } from "node:fs";
import { isEnvironmentName } from "../../src/config/environments.ts";
import { d1Execute } from "../lib/d1.ts";
import { directoryInserts, readDirectoryCsv } from "../lib/pincode-directory.ts";

const [environment] = process.argv.slice(2);
if (!isEnvironmentName(environment)) {
  console.error("usage: node scripts/ops/load-pincode-directory.ts <local|staging|production>");
  process.exit(2);
}

const rows = readDirectoryCsv(readFileSync("data/pincodes/india-pincodes.csv", "utf8"));
const refreshedOn = readFileSync("data/pincodes/india-pincodes.date", "utf8").trim();
if (!/^\d{4}-\d{2}-\d{2}$/.test(refreshedOn)) {
  console.error("data/pincodes/india-pincodes.date holds no date");
  process.exit(1);
}
const statements = directoryInserts(rows, refreshedOn);
// Ten statements a file, a thousand pincodes, so no one call to D1 runs long.
for (let at = 0; at < statements.length; at += 10) d1Execute(environment, statements.slice(at, at + 10));
console.log(`${String(rows.length)} pincodes in ${environment}'s directory, dated ${refreshedOn}`);
