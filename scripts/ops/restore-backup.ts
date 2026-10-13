// node scripts/ops/restore-backup.ts --env <staging|production> --date <YYYY-MM-DD> --key <private.pem> --out <file.sql>
//
// Downloads one weekly backup from the environment's backups bucket, decrypts it with the private key, and
// writes SQL that rebuilds it in an empty database. Work in private/restore/, which git ignores: the SQL holds every
// client's personal data, and is deleted once the restore is done (docs/runbook/restoring-d1.md, "From a weekly backup").

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { backupBindings, retried } from "../lib/backup-bindings.ts";
import { assertBackupOf, Manifest, privateKeyOf, rowsIn, sqlFor, tableKeyOf } from "../lib/backup-restore.ts";

const { values } = parseArgs({
  options: { env: { type: "string" }, date: { type: "string" }, key: { type: "string" }, out: { type: "string" } },
});
const { env, date, key, out } = values;
if ((env !== "staging" && env !== "production") || date === undefined || key === undefined || out === undefined) {
  console.error(
    "usage: restore-backup.ts --env <staging|production> --date <YYYY-MM-DD> --key <private.pem> --out <file.sql>",
  );
  process.exit(2);
}

const { bucket, close } = await backupBindings(env);

/** One object of the backup. */
const fetched = (object: string): Promise<Uint8Array> =>
  retried(async () => {
    const body = await bucket.get(object);
    if (body === null) throw new Error(`${object} is not in the bucket`);
    return new Uint8Array(await body.arrayBuffer());
  });

try {
  const manifest = Manifest.parse(JSON.parse(new TextDecoder().decode(await fetched(`${date}/manifest.json`))));
  assertBackupOf(manifest, env);
  const privateKey = await privateKeyOf(readFileSync(key, "utf8"));
  const rows = new Map<string, Record<string, unknown>[]>();
  for (const table of manifest.tables) {
    const read = await rowsIn(await tableKeyOf(manifest, table, privateKey), table.iv, await fetched(table.object));
    if (read.length !== table.rows)
      throw new Error(`${table.name}: ${String(read.length)} rows, the manifest says ${String(table.rows)}`);
    rows.set(table.name, read);
  }
  writeFileSync(out, sqlFor(manifest, rows), { mode: 0o600 });
  console.log(`${manifest.environment}, ${manifest.created_at}: ${String(manifest.tables.length)} tables into ${out}`);
} finally {
  await close();
}
