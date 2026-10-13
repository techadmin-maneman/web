// node scripts/ops/backup-now.ts --env <staging|production> --public-key <file>
//
// Writes a backup now, as the Sunday job does: the job's own code (src/domain/platform/backups.ts), run from here
// against the environment's database and backups bucket. For the first backup once the key is set, or one before a
// release. <file> holds the public key set as BACKUP_PUBLIC_KEY.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { writeBackup } from "../../src/domain/platform/backups.ts";
import { indiaDate } from "../../src/lib/india-time.ts";
import { backupBindings } from "../lib/backup-bindings.ts";

const { values } = parseArgs({ options: { env: { type: "string" }, "public-key": { type: "string" } } });
const { env, "public-key": keyFile } = values;
if ((env !== "staging" && env !== "production") || keyFile === undefined) {
  console.error("usage: backup-now.ts --env <staging|production> --public-key <file>");
  process.exit(2);
}

const { db, bucket, bucketName, close } = await backupBindings(env);
try {
  const publicKey = readFileSync(keyFile, "utf8").trim();
  const now = new Date();
  const written = await writeBackup({ db, bucket, publicKey, environment: env, now, date: indiaDate(now) });
  console.log(
    written === "already"
      ? "Today's backup is there already."
      : `Written to ${bucketName}/${written.prefix}: ${String(written.tables)} tables, ${String(written.rows)} rows.`,
  );
} finally {
  await close();
}
