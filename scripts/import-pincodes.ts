// Loads data/pincodes/ncr-pincodes.csv into serviceable_pincodes (docs/decisions/0048-referrals.md). Safe to run
// again: each pincode's row is replaced by the file's. Run after migrations.
//
//   node scripts/import-pincodes.ts local
//   node scripts/import-pincodes.ts staging --all-served-from 2026-09-22    (staging's placeholder, open point 21)
//   node scripts/import-pincodes.ts production                              (the file's served and launch_on)
//
// Each pincode's area is named from its post offices (scripts/lib/pincodes.ts).

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXPECTED_DATABASE_NAME, isEnvironmentName } from "../src/config/environments.ts";
import { indiaInstant } from "../src/lib/india-time.ts";
import { areaOf, fields } from "./lib/pincodes.ts";

const [environment, flag, allServedFrom] = process.argv.slice(2);
if (!isEnvironmentName(environment) || (flag !== undefined && flag !== "--all-served-from")) {
  console.error("usage: node scripts/import-pincodes.ts <local|staging|production> [--all-served-from YYYY-MM-DD]");
  process.exit(2);
}
if (flag !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(allServedFrom ?? "")) {
  console.error("--all-served-from takes a date, YYYY-MM-DD");
  process.exit(2);
}

const [header = "", ...lines] = readFileSync("data/pincodes/ncr-pincodes.csv", "utf8").trim().split(/\r?\n/);
const columns = fields(header);
const at = (row: string[], name: string) => row[columns.indexOf(name)] ?? "";

const quote = (value: string | null) => (value === null ? "NULL" : `'${value.replaceAll("'", "''")}'`);
const values = lines.map((line) => {
  const row = fields(line);
  const pincode = at(row, "pincode");
  if (!/^\d{6}$/.test(pincode)) throw new Error(`not a pincode: ${pincode}`);
  const city = at(row, "city");
  const served = allServedFrom === undefined ? at(row, "served").toLowerCase() === "yes" : true;
  const launchOn = allServedFrom ?? (at(row, "launch_on") || null);
  // Midnight in India on the day, as an instant, like every other time in the database. It is read
  // back as India's date (src/domain/service-area.ts), never by cutting the UTC string.
  const launchedAt = launchOn === null ? null : indiaInstant(launchOn, "00:00").toISOString();
  return `(${quote(pincode)}, ${quote(areaOf(at(row, "office_names"), city))}, ${quote(city)}, ${served ? "1" : "0"}, ${quote(launchedAt)})`;
});

const sql = `INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at) VALUES
${values.join(",\n")}
ON CONFLICT (pincode) DO UPDATE SET area = excluded.area, city = excluded.city, served = excluded.served,
  launched_at = excluded.launched_at;`;

const folder = mkdtempSync(join(tmpdir(), "mm-pincodes-"));
try {
  const file = join(folder, "pincodes.sql");
  writeFileSync(file, sql);
  const target =
    environment === "local"
      ? ["DB", "--local", "--env="]
      : [EXPECTED_DATABASE_NAME[environment], "--remote", "--env", environment];
  execFileSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", ...target, "--file", file, "--yes"],
    { stdio: "inherit" },
  );
  console.log(`import-pincodes: ${String(values.length)} pincodes into ${environment}`);
} finally {
  rmSync(folder, { recursive: true, force: true });
}
