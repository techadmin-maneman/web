// node scripts/ops/restore-backup.ts --env <staging|production> --date <YYYY-MM-DD> --key <private.pem> --out <file.sql>
//
// Downloads one weekly backup from the environment's backups bucket, decrypts it with the owner's private key, and
// writes SQL that rebuilds it in an empty database. Work in private/restore/, which git ignores: the SQL holds every
// client's personal data, and is deleted once the restore is done (docs/runbook/restoring-d1.md, "From a weekly backup").

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { backupKeyOf, Manifest, privateKeyOf, rowsIn, sqlFor } from "../lib/backup-restore.ts";

const { values } = parseArgs({
  options: { env: { type: "string" }, date: { type: "string" }, key: { type: "string" }, out: { type: "string" } },
});
const BUCKETS = { staging: "mm-staging-backups", production: "mm-prod-backups" } as const;
const { env, date, key, out } = values;
if ((env !== "staging" && env !== "production") || date === undefined || key === undefined || out === undefined) {
  console.error(
    "usage: restore-backup.ts --env <staging|production> --date <YYYY-MM-DD> --key <private.pem> --out <file.sql>",
  );
  process.exit(2);
}

const bucket = BUCKETS[env];
const scratch = mkdtempSync(path.join(tmpdir(), "mm-backup-"));

/** One object of the backup, fetched with wrangler into the scratch folder. */
function fetched(object: string): Buffer {
  const file = path.join(scratch, path.basename(object));
  const run = spawnSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", "r2", "object", "get", `${bucket}/${object}`, "--file", file, "--remote"],
    { encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(`could not fetch ${object}: ${run.stderr.trim().split("\n").at(-1) ?? ""}`);
  return readFileSync(file);
}

try {
  const manifest = Manifest.parse(JSON.parse(new TextDecoder().decode(fetched(`${date}/manifest.json`))));
  const backupKey = await backupKeyOf(manifest, await privateKeyOf(readFileSync(key, "utf8")));
  const rows = new Map<string, Record<string, unknown>[]>();
  for (const table of manifest.tables) {
    const read = await rowsIn(backupKey, table.iv, fetched(table.object));
    if (read.length !== table.rows)
      throw new Error(`${table.name}: ${String(read.length)} rows, the manifest says ${String(table.rows)}`);
    rows.set(table.name, read);
  }
  writeFileSync(out, sqlFor(manifest, rows), { mode: 0o600 });
  console.log(`${manifest.environment}, ${manifest.created_at}: ${String(manifest.tables.length)} tables into ${out}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
