// An environment's database and backups bucket, reached from this machine through Wrangler's remote bindings: one
// connection for the whole job, from a config of just those two, so nothing else of the Worker's is started or touched.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getPlatformProxy } from "wrangler";
import { z } from "zod";
import type { RemoteEnvironmentName } from "../../src/config/environments.ts";
import { readJsonc } from "./jsonc.ts";

const Config = z.object({
  compatibility_date: z.string(),
  env: z.record(
    z.string(),
    z.object({
      d1_databases: z.array(z.object({ binding: z.string(), database_name: z.string(), database_id: z.string() })),
      r2_buckets: z.array(z.object({ binding: z.string(), bucket_name: z.string() })),
    }),
  ),
});

export interface BackupBindings {
  readonly db: D1Database;
  readonly bucket: R2Bucket;
  readonly bucketName: string;
  readonly close: () => Promise<void>;
}

export async function backupBindings(env: RemoteEnvironmentName): Promise<BackupBindings> {
  const config = Config.parse(readJsonc("wrangler.jsonc"));
  const bindings = config.env[env];
  const database = bindings?.d1_databases.find((each) => each.binding === "DB");
  const bucket = bindings?.r2_buckets.find((each) => each.binding === "BACKUPS");
  if (database === undefined || bucket === undefined)
    throw new Error(`wrangler.jsonc binds no DB or BACKUPS in ${env}`);

  const scratch = mkdtempSync(path.join(tmpdir(), "mm-backup-bindings-"));
  const configPath = path.join(scratch, "wrangler.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      name: "mm-backup-bindings",
      compatibility_date: config.compatibility_date,
      d1_databases: [{ ...database, remote: true }],
      r2_buckets: [{ ...bucket, remote: true }],
    }),
  );
  const proxy = await getPlatformProxy<{ DB: D1Database; BACKUPS: R2Bucket }>({ configPath, persist: false });
  return {
    db: proxy.env.DB,
    bucket: proxy.env.BACKUPS,
    bucketName: bucket.bucket_name,
    close: async () => {
      await proxy.dispose();
      rmSync(scratch, { recursive: true, force: true });
    },
  };
}

/** `attempt`, tried again twice when it throws: a connection dropped mid-job should not end the job. */
export async function retried<T>(attempt: () => Promise<T>, tries = 3): Promise<T> {
  for (let tried = 1; ; tried += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (tried >= tries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000 * tried));
    }
  }
}
