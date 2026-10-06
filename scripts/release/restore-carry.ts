// Writes the carry-back file of a whole-database restore from the export taken just before it
// (docs/runbook/restoring-d1.md, "Restoring the whole database"):
//
//   node scripts/release/restore-carry.ts private/restore/now.sql private/restore/carry.sql --leave photos --leave photo_sets
//
// Each --leave names a table the restore is for, which stays as it was at <T>.

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { carryBack } from "../lib/restore-carry.ts";

const { values, positionals } = parseArgs({
  options: { leave: { type: "string", multiple: true, default: [] } },
  allowPositionals: true,
});
const [exportFile, carryFile] = positionals;
if (exportFile === undefined || carryFile === undefined) {
  console.error("usage: node scripts/release/restore-carry.ts <export.sql> <carry.sql> [--leave <table>]...");
  process.exit(2);
}

const carry = carryBack(readFileSync(exportFile, "utf8"), values.leave);
writeFileSync(carryFile, `${carry.statements.join("\n")}\n`);

const list = (tables: readonly string[]) => (tables.length === 0 ? "none" : tables.join(", "));
console.log(`${carryFile}: ${String(carry.statements.length)} statements`);
console.log(`  emptied and written again: ${String(carry.rewritten.length)} tables`);
console.log(`  only added to: ${list(carry.addOnly)}`);
console.log(`  written to by triggers, so written last: ${list(carry.writtenByTriggers)}`);
console.log(`  left as they were at <T>: ${list(carry.left)}`);
