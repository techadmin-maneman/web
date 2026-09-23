import { env } from "cloudflare:workers";
import { createApp, type App } from "./app.ts";
import { ENABLED_SURFACES, type Surface } from "./config/environments.ts";
import { productionDependencies } from "./dependencies.ts";
import { createCachedIdentityCheck, validateStaticConfig } from "./guard.ts";
import { byHost } from "./http/surfaces.ts";
import { createLogger } from "./log.ts";
import { handleCrmSyncBatch } from "./queues/crm-sync.ts";
import { handleFsmSyncBatch } from "./queues/fsm-sync.ts";
import { handleMessagingBatch, type MessagingMessage } from "./queues/messaging.ts";
import { handleRenderBatch } from "./queues/render.ts";
import { syncBooks } from "./domain/books-sync.ts";
import { recordUtilisation } from "./domain/dispatch.ts";
import { queueReminders } from "./domain/visit-messages.ts";
import { referralPass } from "./scheduled/referrals.ts";
import { alertAgedDeletions } from "./domain/deletion.ts";
import { reconcileFsm } from "./scheduled/reconcile-fsm.ts";
import { sweep } from "./scheduled/sweeper.ts";

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

export default {
  fetch: byHost(apps, config.environment),

  async queue(batch, workerEnv) {
    const log = baseLog.child({ queue: batch.queue });
    const started = Date.now();
    await assertOwnDatabase(workerEnv.DB); // throwing leaves the messages for a retry
    // Consumer runs have stalled for minutes before their first outside call (docs/decisions/0012).
    const identityMs = Date.now() - started;
    if (identityMs > SLOW_STEP_MS) log.warn("slow_step", { step: "database_identity", duration_ms: identityMs });
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
      await handleFsmSyncBatch(batch, workerEnv, deps, log, { labelAsTest: config.environment !== "production" });
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
    const deps = makeDependencies(workerEnv, log);
    await sweep(workerEnv, deps, log, {
      creditFloor: config.settings.tryon.creditFloor,
      fsmErasure: config.providers.FSM_PROVIDER !== "none",
    });
    // The FSM mirror's repair (docs/decisions/0032-fsm-mirror.md), where FSM is connected. A failure is logged and left
    // for the next run; the sweep above is done either way.
    if (config.providers.FSM_PROVIDER !== "none") {
      await reconcileFsm(workerEnv, deps, log.child({ job: "fsm_reconcile" })).catch((error: unknown) => {
        log.error("fsm_reconcile_failed", { error });
      });
    }
    await alertAgedDeletions(workerEnv.DB, deps.now(), deps.alert).catch((error: unknown) => {
      log.error("deletion_alert_failed", { error });
    });
    // The dispatch board's utilisation, written to events once a day: the operating
    // figure behind the model's weekend-share assumption (src/policy/dispatch.ts).
    await recordUtilisation(workerEnv.DB, deps.now())
      .then((date) => {
        if (date !== null) log.info("dispatch_utilisation_recorded", { date });
      })
      .catch((error: unknown) => {
        log.error("dispatch_utilisation_failed", { error });
      });
    const referralMessages = await referralPass(workerEnv.DB, deps.now(), log.child({ job: "referrals" })).catch(
      (error: unknown) => {
        log.error("referrals_failed", { error });
        return [];
      },
    );
    if (referralMessages.length > 0) {
      await workerEnv.MESSAGE_QUEUE.sendBatch(
        referralMessages.map((id) => ({
          body: { message_id: id, request_id: "referrals" } satisfies MessagingMessage,
        })),
      );
    }
    if (config.settings.messaging.enabled) {
      const reminders = await queueReminders(workerEnv.DB, deps.now()).catch((error: unknown) => {
        log.error("visit_reminders_failed", { error });
        return [];
      });
      if (reminders.length > 0) {
        await workerEnv.MESSAGE_QUEUE.sendBatch(
          reminders.map((id) => ({ body: { message_id: id, request_id: "reminders" } satisfies MessagingMessage })),
        );
        log.info("visit_reminders_queued", { count: reminders.length });
      }
    }
    if (config.providers.FSM_PROVIDER !== "none" && config.providers.BOOKS_PROVIDER !== "none") {
      const booksLog = log.child({ job: "books_sync" });
      const options = {
        refundAccountId: config.settings.zohoFsm?.booksRefundAccountId ?? null,
        labelAsTest: config.environment !== "production",
      };
      await syncBooks(workerEnv.DB, deps.fsm, deps.books, options, deps.now(), booksLog)
        .then((done) => {
          if (done.recorded + done.applied + done.refunded > 0) booksLog.info("books_synced", done);
        })
        .catch((error: unknown) => {
          booksLog.error("books_sync_failed", { error });
        });
    }
  },
} satisfies ExportedHandler<Env>;
