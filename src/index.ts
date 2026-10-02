import { env } from "cloudflare:workers";
import { createApp } from "./app.ts";
import type { App } from "./http/context.ts";
import { ENABLED_SURFACES, type Surface } from "./config/environments.ts";
import { productionDependencies } from "./dependencies.ts";
import { alertIfForgotten, MAINTENANCE_RETRY_SECONDS, maintenanceUnderWay } from "./domain/maintenance.ts";
import { createCachedIdentityCheck, validateStaticConfig } from "./guard.ts";
import { byHost } from "./http/surfaces.ts";
import { createLogger, type Logger } from "./log.ts";
import { handleCrmSyncBatch } from "./queues/crm-sync.ts";
import { handleFsmSyncBatch } from "./queues/fsm-sync.ts";
import { handleMessagingBatch } from "./queues/messaging.ts";
import { handleRenderBatch } from "./queues/render.ts";
import { CRON_JOBS, runCron } from "./scheduled/cron.ts";

// Runs at module load. A Worker without a valid ENVIRONMENT, missing a secret
// its providers need, or in production with a stub provider, throws here:
// Cloudflare rejects the upload and wrangler dev refuses to start.
const config = validateStaticConfig(env as unknown as Record<string, unknown>);

const makeDependencies = productionDependencies(config);
/** One app per switched-on surface, chosen by the request's host (docs/decisions/0026). */
const apps = new Map<Surface, App>(
  ENABLED_SURFACES[config.environment].map((surface) => [surface, createApp(config, makeDependencies, surface)]),
);
const checkIdentity = createCachedIdentityCheck();
const baseLog = createLogger({ worker: "mm-api", environment: config.environment });

/** A step slower than this is logged, to find where a stalled consumer run spends its time. */
const SLOW_STEP_MS = 2_000;

/** Queue consumers and the sweeper refuse to touch a database that is not this environment's. */
async function assertOwnDatabase(db: D1Database): Promise<void> {
  const identity = await checkIdentity(db, config.environment);
  if (identity.state !== "ok") throw new Error(`database identity check failed: ${identity.state}`);
}

/** Whether the cron stands still this run for maintenance, which ops are told of once it has gone on too long. */
async function cronHeldForMaintenance(workerEnv: Env, log: Logger): Promise<boolean> {
  const maintenance = await maintenanceUnderWay(workerEnv.DB);
  if (maintenance === null) return false;
  log.warn("cron_stopped_for_maintenance", { since: maintenance.startedAt });
  const deps = makeDependencies(workerEnv, log);
  await alertIfForgotten(maintenance, deps.alertOnce, deps.now());
  return true;
}

/** Whether a queue batch waits out maintenance, to be delivered again a few minutes later. */
async function batchHeldForMaintenance(batch: MessageBatch, db: D1Database, log: Logger): Promise<boolean> {
  if ((await maintenanceUnderWay(db)) === null) return false;
  log.warn("queue_stopped_for_maintenance", { messages: batch.messages.length });
  batch.retryAll({ delaySeconds: MAINTENANCE_RETRY_SECONDS });
  return true;
}

export default {
  fetch: byHost(apps, config.environment),

  async queue(batch, workerEnv) {
    const log = baseLog.child({ queue: batch.queue });
    const started = Date.now();
    await assertOwnDatabase(workerEnv.DB); // throwing leaves the messages for a retry
    // Consumer runs have stalled for minutes before their first outside call (docs/decisions/0012).
    const identityMs = Date.now() - started;
    if (identityMs > SLOW_STEP_MS) log.warn("slow_step", { step: "database_identity", duration_ms: identityMs });
    if (await batchHeldForMaintenance(batch, workerEnv.DB, log)) return;
    const deps = makeDependencies(workerEnv, log);

    if (batch.queue.startsWith("mm-crm-sync-")) {
      await handleCrmSyncBatch(batch, workerEnv.DB, deps, log);
      return;
    }
    if (batch.queue.startsWith("mm-render-")) {
      await handleRenderBatch(batch, workerEnv, deps, log, {
        resultRetentionDays: config.settings.tryon.resultRetentionDays,
      });
      return;
    }
    if (batch.queue.startsWith("mm-fsm-sync-")) {
      await handleFsmSyncBatch(batch, workerEnv, deps, log, {
        labelAsTest: config.environment !== "production",
        cataloguePush: config.settings.fsmCataloguePush,
      });
      return;
    }
    if (batch.queue.startsWith("mm-messaging-")) {
      await handleMessagingBatch(batch, workerEnv.DB, config, deps, log);
      return;
    }
    log.error("unknown_queue", { queue: batch.queue });
    batch.retryAll();
  },

  async scheduled(_controller, workerEnv) {
    const log = baseLog.child({ job: "cron" });
    await assertOwnDatabase(workerEnv.DB);
    if (await cronHeldForMaintenance(workerEnv, log)) return;
    const deps = makeDependencies(workerEnv, log);
    await runCron(CRON_JOBS, { env: workerEnv, deps, config, log });
  },
} satisfies ExportedHandler<Env>;
