import { env } from "cloudflare:workers";
import { createApp } from "./app.ts";
import { productionDependencies } from "./dependencies.ts";
import { createCachedIdentityCheck, validateStaticConfig } from "./guard.ts";
import { createLogger } from "./log.ts";
import { handleCrmSyncBatch } from "./queues/crm-sync.ts";
import { handleMessagingBatch } from "./queues/messaging.ts";
import { handleRenderBatch } from "./queues/render.ts";
import { sweep } from "./scheduled/sweeper.ts";

// Runs at module load. A Worker without a valid ENVIRONMENT, missing a secret
// its providers need, or in production with a stub provider, throws here:
// Cloudflare rejects the upload and wrangler dev refuses to start.
const config = validateStaticConfig(env as unknown as Record<string, unknown>);

const app = createApp(config);
const makeDependencies = productionDependencies(config);
const checkIdentity = createCachedIdentityCheck();
const baseLog = createLogger({ worker: "mm-api", environment: config.environment });

/** Queue consumers and the sweeper refuse to touch a database that is not this environment's. */
async function assertOwnDatabase(db: D1Database): Promise<void> {
  const identity = await checkIdentity(db, config.environment);
  if (identity.state !== "ok") throw new Error(`database identity check failed: ${identity.state}`);
}

export default {
  fetch: app.fetch,

  async queue(batch, workerEnv) {
    const log = baseLog.child({ queue: batch.queue });
    await assertOwnDatabase(workerEnv.DB); // throwing leaves the messages for a retry
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
    if (batch.queue.startsWith("mm-messaging-")) {
      await handleMessagingBatch(batch, workerEnv.DB, config, deps, log);
      return;
    }
    log.error("unknown_queue", { queue: batch.queue });
    batch.retryAll();
  },

  async scheduled(_controller, workerEnv) {
    const log = baseLog.child({ job: "sweeper" });
    await assertOwnDatabase(workerEnv.DB);
    await sweep(workerEnv, makeDependencies(workerEnv, log), log, { creditFloor: config.settings.tryon.creditFloor });
  },
} satisfies ExportedHandler<Env>;
