// The five-minute cron (wrangler.jsonc "triggers"): every job below, in this
// order. A job that throws is logged as `cron_job_failed` and the next one runs
// anyway, so one failing job never stops the others. Each job's failed runs in
// a row are counted in `cron_jobs`, and a job that fails three in a row alerts
// (docs/decisions/0067-alerts-and-silent-failures.md).
//
// The jobs share one budget of outside calls a run, so that together they stay
// under the free plan's 50 subrequests (src/lib/call-budget.ts).

import type { Dependencies } from "../dependencies.ts";
import { resolveAskedWindows } from "../domain/asked-windows.ts";
import { requeueUnbookedHolds } from "../domain/bookings.ts";
import { syncBooks } from "../domain/books-sync.ts";
import { alertAgedDeletions } from "../domain/deletion.ts";
import { checkCatalogue } from "../domain/fsm-catalogue.ts";
import { recordUtilisation } from "../domain/dispatch.ts";
import { deleteLeftFiles } from "../domain/erasure.ts";
import { raiseInvoices } from "../domain/fsm-invoices.ts";
import { queueReminders } from "../domain/visit-messages.ts";
import type { StaticConfig } from "../guard.ts";
import { createCallBudget, type CallBudget } from "../lib/call-budget.ts";
import { scrubString, type Logger } from "../log.ts";
import type { MessagingMessage } from "../queues/messaging.ts";
import { reconcileFsm } from "./reconcile-fsm.ts";
import { referralPass } from "./referrals.ts";
import { sweep } from "./sweeper.ts";
import { checkWhatsAppBridge } from "./whatsapp-bridge.ts";

export interface CronContext {
  readonly env: Env;
  readonly deps: Dependencies;
  readonly config: StaticConfig;
  /** Carries the job's name on every line. */
  readonly log: Logger;
  /** The run's outside calls, shared by every job in it. */
  readonly budget: CallBudget;
}

/**
 * Outside calls one run may make. The free plan allows 50 subrequests an
 * invocation; the other ten are for what no job can plan: a Zoho token
 * refresh, and the alerts the run sends.
 */
export const CRON_CALLS = 40;

/** One failed run is a blip; three in a row is a quarter of an hour of it. */
const ALERT_AFTER_FAILED_RUNS = 3;

/**
 * What a job needs switched on in this environment before it runs. "fsm_record" is the real FSM: the stub remembers
 * no appointment, so a job that trusts FSM's word on what exists would take it that every visit had been deleted.
 */
type Needs = "nothing" | "fsm" | "fsm_record" | "fsm_and_books" | "messaging";

export interface CronJob {
  readonly name: string;
  readonly needs: Needs;
  readonly run: (context: CronContext) => Promise<void>;
}

export interface CronOutcome {
  readonly job: string;
  readonly ok: boolean;
}

function isSwitchedOn(needs: Needs, config: StaticConfig): boolean {
  const fsm = config.providers.FSM_PROVIDER !== "none";
  const books = config.providers.BOOKS_PROVIDER !== "none";
  switch (needs) {
    case "nothing":
      return true;
    case "fsm":
      return fsm;
    case "fsm_record":
      return config.providers.FSM_PROVIDER === "zoho";
    case "fsm_and_books":
      return fsm && books;
    case "messaging":
      return config.settings.messaging.enabled;
  }
}

async function queueMessages(queue: Queue, ids: readonly string[], requestId: string): Promise<void> {
  if (ids.length === 0) return;
  await queue.sendBatch(
    ids.map((id) => ({ body: { message_id: id, request_id: requestId } satisfies MessagingMessage })),
  );
}

async function sweepJob({ env, deps, config, log, budget }: CronContext): Promise<void> {
  await sweep(env, deps, log, {
    creditFloor: config.settings.tryon.creditFloor,
    fsmConnected: config.providers.FSM_PROVIDER !== "none",
    budget,
  });
}

async function unbookedHoldsJob({ env, deps, log, budget }: CronContext): Promise<void> {
  const requeued = await requeueUnbookedHolds(
    env.DB,
    { queue: env.FSM_QUEUE, alertOnce: deps.alertOnce, budget, log },
    deps.now(),
  );
  if (requeued > 0) log.warn("unbooked_holds_requeued", { count: requeued });
}

async function erasedFilesJob({ env, deps, log }: CronContext): Promise<void> {
  const finished = await deleteLeftFiles(env, deps.now(), log);
  if (finished > 0) log.info("erased_files_deleted", { people: finished });
}

async function reconcileJob({ env, deps, log, budget }: CronContext): Promise<void> {
  await reconcileFsm(env, deps, log, budget);
}

async function catalogueJob({ env, deps, config, log, budget }: CronContext): Promise<void> {
  const checked = await checkCatalogue(
    env.DB,
    { fsm: deps.fsm, queue: env.FSM_QUEUE, alertOnce: deps.alertOnce, resolveAlert: deps.resolveAlert, log },
    { push: config.settings.fsmCataloguePush, now: deps.now(), budget },
  );
  if (checked !== null && checked.differs.length > 0) log.warn("fsm_catalogue_differs", { ...checked });
}

async function deletionAlertsJob({ env, deps }: CronContext): Promise<void> {
  await alertAgedDeletions(env.DB, deps.now(), deps.alert);
}

async function whatsAppBridgeJob({ deps, log, budget }: CronContext): Promise<void> {
  await checkWhatsAppBridge(deps, log, budget);
}

async function utilisationJob({ env, deps, log }: CronContext): Promise<void> {
  const date = await recordUtilisation(env.DB, deps.now());
  if (date !== null) log.info("dispatch_utilisation_recorded", { date });
}

async function referralsJob({ env, deps, log }: CronContext): Promise<void> {
  const messages = await referralPass(env.DB, deps.now(), log);
  await queueMessages(env.MESSAGE_QUEUE, messages, "referrals");
}

async function remindersJob({ env, deps, log }: CronContext): Promise<void> {
  const reminders = await queueReminders(env.DB, deps.now());
  await queueMessages(env.MESSAGE_QUEUE, reminders, "reminders");
  if (reminders.length > 0) log.info("visit_reminders_queued", { count: reminders.length });
}

async function invoicesJob({ env, deps, log, budget }: CronContext): Promise<void> {
  const done = await raiseInvoices(env.DB, deps, deps.now(), log, budget);
  if (done.raised + done.issued > 0) log.info("invoices_raised", done);
}

async function askedWindowsJob({ env, deps, log, budget }: CronContext): Promise<void> {
  const done = await resolveAskedWindows(env.DB, deps.fsm, deps.now(), log, budget);
  if (done.resolved > 0) log.info("asked_windows_resolved", done);
}

async function booksJob({ env, deps, config, log, budget }: CronContext): Promise<void> {
  const options = {
    refundAccountId: config.settings.zohoFsm?.booksRefundAccountId ?? null,
    labelAsTest: config.environment !== "production",
  };
  const done = await syncBooks(env.DB, deps, options, deps.now(), log, budget);
  if (done.recorded + done.applied + done.refunded > 0) log.info("books_synced", done);
}

export const CRON_JOBS: readonly CronJob[] = [
  { name: "sweeper", needs: "nothing", run: sweepJob },
  // A hold paid for and neither booked nor refunded half an hour on (docs/decisions/0068-a-paid-hold-is-kept.md).
  { name: "unbooked_holds", needs: "fsm", run: unbookedHoldsJob },
  // What an erasure could not delete from R2 at the time (docs/decisions/0066-erasure-all-or-nothing.md).
  { name: "erased_files", needs: "nothing", run: erasedFilesJob },
  // The FSM mirror's repair (docs/decisions/0032-fsm-mirror.md).
  { name: "fsm_reconcile", needs: "fsm_record", run: reconcileJob },
  // Once an hour: FSM's catalogue against the price book, which it prices invoices by
  // (docs/decisions/0073-prices-from-the-price-book.md), and against ops' consumables, which it holds
  // as parts (docs/decisions/0087-consumables-and-stock.md).
  { name: "fsm_catalogue", needs: "fsm", run: catalogueJob },
  { name: "deletion_alerts", needs: "nothing", run: deletionAlertsJob },
  // Every login code goes through the WhatsApp bridge (src/scheduled/whatsapp-bridge.ts).
  { name: "whatsapp_bridge", needs: "nothing", run: whatsAppBridgeJob },
  // Once a day: the operating figure behind the weekend-share assumption (src/policy/dispatch.ts).
  { name: "dispatch_utilisation", needs: "nothing", run: utilisationJob },
  { name: "referrals", needs: "nothing", run: referralsJob },
  { name: "visit_reminders", needs: "messaging", run: remindersJob },
  // A finished job's invoice (ADRs 0055 and 0056), before the Books pass, which sets
  // a client's advance against the invoice once it is issued.
  { name: "invoices", needs: "fsm_and_books", run: invoicesJob },
  // What the client asked for, beside what the board offers them (ADR 0063).
  { name: "asked_windows", needs: "fsm_and_books", run: askedWindowsJob },
  { name: "books_sync", needs: "fsm_and_books", run: booksJob },
];

/** Runs each job switched on here, in order, each under a logger named for it, on one budget of outside calls. */
export async function runCronJobs(jobs: readonly CronJob[], run: Omit<CronContext, "budget">): Promise<CronOutcome[]> {
  const budget = createCallBudget(CRON_CALLS);
  const outcomes: CronOutcome[] = [];
  for (const job of jobs) {
    if (!isSwitchedOn(job.needs, run.config)) continue;
    const context = { ...run, log: run.log.child({ job: job.name }), budget };
    try {
      await job.run(context);
      outcomes.push({ job: job.name, ok: true });
      await countSuccess(context, job.name);
    } catch (error) {
      context.log.error("cron_job_failed", { error });
      outcomes.push({ job: job.name, ok: false });
      await countFailure(context, job.name, error);
    }
  }
  if (budget.ranOut()) run.log.warn("cron_calls_spent", { calls: CRON_CALLS });
  return outcomes;
}

/** A job that works again starts its count afresh, and its alert is closed. */
async function countSuccess({ env, deps, log }: CronContext, job: string): Promise<void> {
  try {
    const recovered = await env.DB.prepare(
      "UPDATE cron_jobs SET failed_runs = 0 WHERE job = ?1 AND failed_runs > 0 RETURNING job",
    )
      .bind(job)
      .first();
    if (recovered !== null) await deps.resolveAlert(`cron_job:${job}`);
  } catch (error) {
    log.error("cron_outcome_not_counted", { error });
  }
}

async function countFailure({ env, deps, log }: CronContext, job: string, error: unknown): Promise<void> {
  const reason = scrubString(error instanceof Error ? error.message : String(error)).slice(0, 300);
  try {
    const row = await env.DB.prepare(
      `INSERT INTO cron_jobs (job, failed_runs, last_failed_at, last_error) VALUES (?1, 1, ?2, ?3)
       ON CONFLICT (job) DO UPDATE SET failed_runs = failed_runs + 1, last_failed_at = excluded.last_failed_at,
         last_error = excluded.last_error
       RETURNING failed_runs`,
    )
      .bind(job, deps.now().toISOString(), reason)
      .first<{ failed_runs: number }>();
    const failedRuns = row?.failed_runs ?? 1;
    if (failedRuns < ALERT_AFTER_FAILED_RUNS) return;
    await deps.alertOnce({
      key: `cron_job:${job}`,
      message: `The cron's ${job} job has failed ${String(failedRuns)} runs in a row: ${reason}.`,
    });
  } catch (countingError) {
    log.error("cron_outcome_not_counted", { error: countingError });
  }
}
