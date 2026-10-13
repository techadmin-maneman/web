// The weekly backup as a Workflow (docs/runbook/restoring-d1.md, "From a weekly backup";
// docs/decisions/0196-long-work-in-workflows.md): the database's schema read once, then a step for each table, each
// under a key of its own and tried again on its own, the manifest last, then backups past thirteen weeks let go. The
// cron starts one a week, named for the Sunday (src/scheduled/cron.ts).

import {
  backupFolder,
  backupIsWhole,
  deleteOldBackups,
  schemaOf,
  writeManifest,
  writeTable,
  type WrittenTable,
} from "../domain/platform/backups.ts";
import { failureReason } from "../log.ts";
import { STEP_RETRIES, type Steps, type WorkflowRun } from "./steps.ts";

export async function backUp(steps: Steps, run: WorkflowRun, date: string): Promise<void> {
  const { env, config, deps } = run;
  const publicKey = config.settings.backupPublicKey;
  if (publicKey === null) return;
  const prefix = backupFolder(date);
  try {
    const schema = await steps.do("schema", STEP_RETRIES, async () =>
      (await backupIsWhole(env.BACKUPS, prefix)) ? null : schemaOf(env.DB),
    );
    if (schema === null) return;
    const written: WrittenTable[] = [];
    for (const table of schema.tables) {
      written.push(
        await steps.do(`table ${table.name}`, STEP_RETRIES, () =>
          writeTable(env.DB, env.BACKUPS, { prefix, table, publicKey }),
        ),
      );
    }
    await steps.do("manifest", STEP_RETRIES, async () => {
      await writeManifest(env.BACKUPS, {
        prefix,
        environment: config.environment,
        createdAt: new Date(),
        schema,
        written,
      });
      return true;
    });
    await steps.do("prune", STEP_RETRIES, () => deleteOldBackups(env.BACKUPS, new Date()));
    await steps.do("tell", STEP_RETRIES, async () => {
      await deps.resolveAlert("backup_failed");
      await deps.resolveAlert("backup_not_configured");
      return true;
    });
  } catch (error) {
    await steps.do("tell of the failure", STEP_RETRIES, async () => {
      await deps.alertOnce({
        key: "backup_failed",
        message: `The weekly backup failed: ${failureReason(error)}. The cron starts it again within the hour; RB "From a weekly backup".`,
      });
      return true;
    });
    throw error;
  }
}
