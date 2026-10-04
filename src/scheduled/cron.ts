// The cron (wrangler.jsonc "triggers"): a run every minute, each running only the jobs due in that minute. The free
// plan stops a run past 10 ms of CPU, and one run of every job took 30 to 60 ms, so the jobs take turns: CRON_JOBS
// gives each how often it runs (`every`) and in which minute of that period (`at`), at most three to a minute
// (docs/decisions/0009-stay-inside-cloudflare-free-tier.md, "the cron's CPU time").
//
// A job that throws is logged as `cron_job_failed` and the next one runs anyway, so one failing job never stops the
// others. Each job's failed runs in a row are counted in `cron_jobs`, and a job that fails three in a row alerts
// (docs/decisions/0067-alerts-and-silent-failures.md). Each run is noted as it starts and as it finishes, so a run
// Cloudflare stopped part-way is told by the next (src/domain/cron-runs.ts), and an outside monitor is pinged every
// five minutes, and at once when something is wrong (src/providers/heartbeat.ts).
//
// The jobs of a run share one budget of outside calls, so that together they stay under the free plan's 50 fetch
// subrequests (src/lib/call-budget.ts). Their calls to D1, R2 and the queues are a separate allowance of 1,000 a run,
// kept by each job's batch sizes (docs/decisions/0093-the-storage-meter.md).

import { BOOKS_ITEM_PUSH, OPS_ORIGIN } from "../config/environments.ts";
import { NO_GST, type GstRegistration } from "../config/gst.ts";
import type { Dependencies } from "../dependencies.ts";
import { bookUnbookedHolds } from "../domain/bookings.ts";
import { eraseBooksCustomers } from "../domain/books-erasure.ts";
import { raiseBooksInvoices } from "../domain/books-invoices.ts";
import { checkBooksItems } from "../domain/books-items.ts";
import { syncBooks, type BooksSyncOptions } from "../domain/books-sync.ts";
import { settleOwedRefunds } from "../domain/cancel-refunds.ts";
import { finishRun, startRun, type RunStart } from "../domain/cron-runs.ts";
import { alertAgedDeletions } from "../domain/deletion.ts";
import { recordUtilisation } from "../domain/dispatch.ts";
import { deleteLeftFiles } from "../domain/erasure.ts";
import { tellOfNewGrievances } from "../domain/grievances.ts";
import { queueCreditReminders } from "../domain/credit-reminders.ts";
import { queueNextServiceReminders } from "../domain/next-visit.ts";
import { sendUnsentLinks } from "../domain/payment-links.ts";
import { readOpsInputs, type OpsInputs } from "../domain/ops-settings.ts";
import { readDatabaseBytes, tellOfDatabaseSize, tellOfStorage } from "../domain/storage-meter.ts";
import { queueReminders } from "../domain/visit-messages.ts";
import type { StaticConfig } from "../guard.ts";
import { createCallBudget, type CallBudget } from "../lib/call-budget.ts";
import { meterDatabase, usageFields, usageSince, type MeteredDatabase } from "../lib/d1-meter.ts";
import { scrubString, type Logger } from "../log.ts";
import { pingHeartbeat } from "../providers/heartbeat.ts";
import { enqueue, enqueueBatch } from "../queues/enqueue.ts";
import type { MessagingMessage } from "../queues/messaging.ts";
import { checkDailyAllowances } from "./daily-allowances.ts";
import { razorpayCatchUpJob } from "./razorpay-catch-up.ts";
import { referralPass } from "./referrals.ts";
import {
  checkAilabCredits,
  deletePhotos,
  expireTryOns,
  housekeep,
  letKeptLooksGo,
  requeueCrmErasures,
  requeueLeads,
  requeueMessages,
  requeueTryons,
} from "./sweeper.ts";
import { CRON_CALLS, type Timing } from "./schedule.ts";
import { checkWhatsAppBridge } from "./whatsapp-bridge.ts";

export interface CronContext {
  readonly env: Env;
  readonly deps: Dependencies;
  readonly config: StaticConfig;
  /** Carries the job's name on every line. */
  readonly log: Logger;
  /** The run's outside calls, shared by every job in it. */
  readonly budget: CallBudget;
  /** The figures ops set, read once for the run by the first job that asks. */
  readonly inputs: () => Promise<OpsInputs>;
}

/** What a run is given; the budget and the figures ops set are the run's own, shared by its jobs. */
export type CronRun = Omit<CronContext, "budget" | "inputs"> & {
  /**
   * The meter env.DB already reads through, which the run's dependencies were made with too. Without one the run
   * meters env.DB itself, and what its dependencies read (an alert raised or closed) goes uncounted.
   */
  readonly meter?: MeteredDatabase;
  /** The outside calls the run may make (callsFor); CRON_CALLS when not given. */
  readonly calls?: number;
};

/** A run starts no outside call after this, so it ends before the next minute's run starts. */
export const CRON_CALLS_FOR_MS = 30_000;

/** One failed run is a blip; three in a row is not. */
const ALERT_AFTER_FAILED_RUNS = 3;

/** What a job needs switched on in this environment before it runs. */
type Needs = "nothing" | "books" | "messaging" | "payments";

/** A job, and when it runs (src/scheduled/schedule.ts). */
export interface CronJob extends Timing {
  readonly name: string;
  readonly needs: Needs;
  readonly run: (context: CronContext) => Promise<unknown>;
}

export interface CronOutcome {
  readonly job: string;
  readonly ok: boolean;
}

function isSwitchedOn(needs: Needs, config: StaticConfig): boolean {
  switch (needs) {
    case "nothing":
      return true;
    case "books":
      return config.providers.BOOKS_PROVIDER !== "none";
    case "messaging":
      return config.settings.messaging.enabled;
    case "payments":
      return config.providers.PAYMENTS_PROVIDER !== "none";
  }
}

/** Messages the job wrote to the outbox. Those the queue refuses, the sweeper sends minutes later. */
async function queueMessages(
  { env, log }: Pick<CronContext, "env" | "log">,
  ids: readonly string[],
  requestId: string,
): Promise<void> {
  const requests = ids.map((id) => ({ body: { message_id: id, request_id: requestId } satisfies MessagingMessage }));
  await enqueueBatch(env.MESSAGE_QUEUE, requests, { log, ifLost: "sweeper" });
}

/** Holds paid for, or booked free, whose request failed before they were booked: booked here half an hour on. */
async function unbookedHoldsJob({ env, deps, log, budget }: CronContext): Promise<void> {
  const notify = (messageId: string) => {
    const body = { message_id: messageId, request_id: "unbooked-holds" } satisfies MessagingMessage;
    return enqueue(env.MESSAGE_QUEUE, body, { log, ifLost: "sweeper" });
  };
  const pass = { ...deps, notify, budget, log };
  const booked = await bookUnbookedHolds(env.DB, pass, deps.now());
  if (booked > 0) log.warn("unbooked_holds_booked", { count: booked });
}

async function cancelRefundsJob({ env, deps, log, budget }: CronContext): Promise<void> {
  const settled = await settleOwedRefunds(env.DB, { ...deps, budget, log }, deps.now());
  if (settled > 0) log.warn("cancel_refunds_settled", { count: settled });
}

async function erasedFilesJob({ env, deps, log }: CronContext): Promise<void> {
  const finished = await deleteLeftFiles(env, deps.now(), log);
  if (finished > 0) log.info("erased_files_deleted", { people: finished });
}

async function booksErasuresJob({ env, deps, log, budget }: CronContext): Promise<void> {
  const erased = await eraseBooksCustomers(env.DB, { ...deps, log, budget }, deps.now());
  if (erased > 0) log.info("books_customers_erased", { count: erased });
}

async function deletionAlertsJob({ env, deps }: CronContext): Promise<void> {
  await alertAgedDeletions(env.DB, deps.now(), deps.alertOnce);
}

async function grievanceAlertsJob({ env, deps, config }: CronContext): Promise<void> {
  await tellOfNewGrievances(env.DB, deps.alert, `${OPS_ORIGIN[config.environment]}/grievances`, deps.now());
}

/** R2's share and the database fill over months, so an hourly look is enough. */
async function storageMeterJob({ env, deps }: CronContext): Promise<void> {
  await tellOfStorage(env.DB, deps.alertOnce);
  await tellOfDatabaseSize(env.DB, deps.alertOnce, await readDatabaseBytes(env.DB));
}

/** Only where a token to read the account's analytics is set. */
async function dailyAllowancesJob({ env, deps, config, log, budget }: CronContext): Promise<void> {
  const token = config.settings.analyticsToken;
  if (token === null) return;
  await checkDailyAllowances({ db: env.DB, deps, token, log, budget });
}

async function whatsAppBridgeJob({ deps, log, budget }: CronContext): Promise<void> {
  await checkWhatsAppBridge(deps, log, budget);
}

/** Records yesterday's figure on the first run of the day; the day's later runs find it recorded. */
async function utilisationJob({ env, deps, log }: CronContext): Promise<void> {
  const date = await recordUtilisation(env.DB, deps.now());
  if (date !== null) log.info("dispatch_utilisation_recorded", { date });
}

async function referralsJob({ env, deps, log, inputs }: CronContext): Promise<void> {
  const messages = await referralPass(env.DB, deps.now(), log, (await inputs()).referralReward);
  await queueMessages({ env, log }, messages, "referrals");
}

async function remindersJob({ env, deps, log, inputs }: CronContext): Promise<void> {
  const now = deps.now();
  const reminders = await queueReminders(env.DB, now, (await inputs()).reminderHour);
  await queueMessages({ env, log }, reminders, "reminders");
  if (reminders.length > 0) log.info("visit_reminders_queued", { count: reminders.length });
}

async function nextServiceRemindersJob({ env, deps, log, inputs }: CronContext): Promise<void> {
  const now = deps.now();
  const { nextVisitDays, reminderHour } = await inputs();
  const reminders = await queueNextServiceReminders(env.DB, now, nextVisitDays, reminderHour);
  await queueMessages({ env, log }, reminders, "next-service-reminders");
  if (reminders.length > 0) log.info("next_service_reminders_queued", { count: reminders.length });
}

async function creditRemindersJob({ env, deps, log, inputs }: CronContext): Promise<void> {
  const reminders = await queueCreditReminders(env.DB, deps.now(), (await inputs()).reminderHour);
  await queueMessages({ env, log }, reminders, "credit-reminders");
  if (reminders.length > 0) log.info("credit_reminders_queued", { count: reminders.length });
}

async function paymentLinksJob({ env, deps, config, log, budget }: CronContext): Promise<void> {
  const linkDeps = { ...deps, log, messagingSettings: config.settings.messaging };
  const sent = await sendUnsentLinks(env.DB, linkDeps, deps.now(), budget);
  if (sent > 0) log.info("payment_links_sent", { count: sent });
}

async function invoicesJob({ env, deps, config, log, budget }: CronContext): Promise<void> {
  const options = { labelAsTest: config.environment !== "production", gst: booksGst(config) };
  const done = await raiseBooksInvoices(env.DB, deps, options, deps.now(), log, budget);
  if (done.raised + done.issued > 0) log.info("invoices_raised", done);
}

/** The Books item each service offered today is invoiced on. */
async function booksItemsJob({ env, deps, config, log, budget }: CronContext): Promise<void> {
  const checked = await checkBooksItems(
    env.DB,
    { books: deps.books, alertOnce: deps.alertOnce, resolveAlert: deps.resolveAlert, log },
    { push: BOOKS_ITEM_PUSH[config.environment], sac: booksGst(config).sac, now: deps.now(), budget },
  );
  if (checked !== null && checked.differs.length > 0) log.warn("books_items_differ", { ...checked });
}

/** The refund account Books' own settings name, and whether what the pass records is labelled as a test. */
export function booksSyncOptions(config: StaticConfig): BooksSyncOptions {
  return {
    refundAccountId: config.settings.zohoBooks?.refundAccountId ?? null,
    labelAsTest: config.environment !== "production",
    gst: booksGst(config),
  };
}

/** The GST registration Books carries here; none where Books is not Zoho's. */
function booksGst(config: StaticConfig): GstRegistration {
  return config.settings.zohoBooks?.gst ?? NO_GST;
}

async function booksJob({ env, deps, config, log, budget }: CronContext): Promise<void> {
  const done = await syncBooks(env.DB, deps, booksSyncOptions(config), deps.now(), log, budget);
  const written = done.customers + done.customersUpdated + done.recorded + done.applied + done.refunded;
  if (written > 0) log.info("books_synced", done);
}

async function ailabCreditsJob(context: CronContext): Promise<void> {
  await checkAilabCredits(context, context.config.settings.tryon.creditFloor);
}

/**
 * Every job, and when it runs (src/scheduled/schedule.ts). No minute holds more than three jobs, and a job that calls a
 * vendor every time it runs (CALLS_EVERY_RUN) shares its minute with one job at most. Minutes by their place in the
 * five: 1 the WhatsApp bridge, 2 the try-ons and the heartbeat, 3 the holds and Books, 4 the hourly jobs. A run's jobs
 * run in this order.
 */
export const CRON_JOBS: readonly CronJob[] = [
  // Every five minutes. Every login code goes through the WhatsApp bridge (src/scheduled/whatsapp-bridge.ts).
  { name: "whatsapp_bridge", needs: "nothing", every: 5, at: 1, run: whatsAppBridgeJob },
  { name: "requeue_tryons", needs: "nothing", every: 5, at: 2, run: requeueTryons },
  // A one visit's payment link its close could not have Razorpay make (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
  { name: "payment_links", needs: "nothing", every: 5, at: 2, run: paymentLinksJob },
  // A hold paid for and neither booked nor refunded half an hour on (docs/decisions/0068-a-paid-hold-is-kept.md).
  { name: "unbooked_holds", needs: "nothing", every: 5, at: 3, run: unbookedHoldsJob },
  { name: "requeue_messages", needs: "nothing", every: 5, at: 4, run: requeueMessages },

  // Every fifteen minutes.
  { name: "visit_reminders", needs: "messaging", every: 15, at: 1, run: remindersJob },
  // A finished job's invoice (ADRs 0055 and 0056), before the Books pass, which sets a client's advance against the
  // invoice once it is issued.
  { name: "invoices", needs: "books", every: 15, at: 3, run: invoicesJob },
  // A payment Razorpay's webhook never told us of, read from Razorpay, before the Books pass that records it there.
  { name: "razorpay_catch_up", needs: "payments", every: 15, at: 3, run: razorpayCatchUpJob },
  { name: "referrals", needs: "nothing", every: 15, at: 6, run: referralsJob },
  { name: "books_sync", needs: "books", every: 15, at: 8, run: booksJob },
  { name: "delete_photos", needs: "nothing", every: 15, at: 11, run: deletePhotos },
  { name: "requeue_leads", needs: "nothing", every: 15, at: 12, run: requeueLeads },
  // A cancel, the client's or ops', whose refund its request could not settle, asked for again under its receipt.
  { name: "cancel_refunds", needs: "nothing", every: 15, at: 13, run: cancelRefundsJob },

  // Every hour. The Books item each service is invoiced on, before the invoices that need one; its check still does
  // nothing after the hour's first five minutes (src/domain/books-items.ts), so it runs in one of them.
  { name: "books_items", needs: "books", every: 60, at: 4, run: booksItemsJob },
  { name: "expire_tryons", needs: "nothing", every: 60, at: 9, run: expireTryOns },
  { name: "ailab_credits", needs: "nothing", every: 60, at: 14, run: ailabCreditsJob },
  { name: "kept_looks", needs: "nothing", every: 60, at: 19, run: letKeptLooksGo },
  { name: "deletion_alerts", needs: "nothing", every: 60, at: 24, run: deletionAlertsJob },
  // The grievances raised in the hour, in one message, so one client cannot flood the chat.
  { name: "grievance_alerts", needs: "nothing", every: 60, at: 24, run: grievanceAlertsJob },
  { name: "housekeeping", needs: "nothing", every: 60, at: 28, run: housekeep },
  // An erased client's customer in Books, deleted, or blanked where an invoice names it.
  { name: "books_erasures", needs: "books", every: 60, at: 29, run: booksErasuresJob },
  // What the account has used today of the free plan's daily allowances, told at 70%.
  { name: "daily_allowances", needs: "nothing", every: 60, at: 34, run: dailyAllowancesJob },
  // What the photographs and cards hold of R2, told at half, 80% and all of their share (docs/decisions/0093), and
  // the database against D1's limit, told at half, 80% and 95%.
  { name: "storage_meter", needs: "nothing", every: 60, at: 39, run: storageMeterJob },
  // The operating figure behind the weekend-share assumption (src/policy/dispatch.ts): once a day, the day's board.
  { name: "dispatch_utilisation", needs: "nothing", every: 60, at: 43, run: utilisationJob },
  // The next service falling due with nothing booked (docs/decisions/0086-the-next-visit-is-offered.md).
  { name: "next_service_reminders", needs: "messaging", every: 60, at: 44, run: nextServiceRemindersJob },
  // Free service visits running out: a month, then a week, before their last day.
  { name: "credit_reminders", needs: "messaging", every: 60, at: 49, run: creditRemindersJob },
  // What an erasure could not delete from R2 at the time (docs/decisions/0066-erasure-all-or-nothing.md).
  { name: "erased_files", needs: "nothing", every: 60, at: 59, run: erasedFilesJob },
  { name: "requeue_crm_erasures", needs: "nothing", every: 60, at: 59, run: requeueCrmErasures },
];

/**
 * The figures ops set, read by the first job that asks and shared by the rest of the run, so a run reads the store
 * once however many jobs use it; the committed ones if it cannot be read, which is said once in the log.
 */
function sharedInputs({ env, deps, log }: CronRun): () => Promise<OpsInputs> {
  let read: Promise<OpsInputs> | undefined;
  return () => {
    read ??= readOpsInputs(env.DB, deps.now(), (error) => {
      log.error("ops_settings_unreadable", { error });
    });
    return read;
  };
}

/** What a run did, and when the run before it started if that one never finished. */
interface RunResult {
  readonly outcomes: CronOutcome[];
  readonly cutShortAt: string | null;
}

/**
 * Runs each job switched on here, in order, each under a logger named for it, on one budget of outside calls and one
 * read of the figures ops set. The run ends with one line saying what it cost D1, and what each job read of it.
 */
export async function runCronJobs(jobs: readonly CronJob[], given: CronRun): Promise<CronOutcome[]> {
  return (await runJobs(jobs, given)).outcomes;
}

async function runJobs(jobs: readonly CronJob[], given: CronRun): Promise<RunResult> {
  const { run, meter } = metered(given);
  const startedAt = run.deps.now();
  const { cutShortAt, failing } = await recordStart(run, startedAt.toISOString());
  const budget = createCallBudget(run.calls ?? CRON_CALLS, {
    until: startedAt.getTime() + CRON_CALLS_FOR_MS,
    now: () => run.deps.now().getTime(),
  });
  const inputs = sharedInputs(run);
  const outcomes: CronOutcome[] = [];
  const rowsReadByJob: Record<string, number> = {};
  for (const job of jobs) {
    if (!isSwitchedOn(job.needs, run.config)) continue;
    const context = { ...run, log: run.log.child({ job: job.name }), budget, inputs };
    const before = meter.usage();
    try {
      await job.run(context);
      outcomes.push({ job: job.name, ok: true });
      if (failing.has(job.name)) await countSuccess(context, job.name);
    } catch (error) {
      context.log.error("cron_job_failed", { error });
      outcomes.push({ job: job.name, ok: false });
      await countFailure(context, job.name, error);
    }
    rowsReadByJob[job.name] = usageSince(before, meter.usage()).rowsRead;
  }
  if (budget.ranOut()) run.log.warn("cron_calls_spent", { calls: run.calls ?? CRON_CALLS });
  await recordFinish(run, startedAt.toISOString(), failedJobs(outcomes).length);
  run.log.info("cron_run", {
    failed_jobs: failedJobs(outcomes),
    ...usageFields(meter.usage()),
    d1_rows_read_by_job: rowsReadByJob,
  });
  return { outcomes, cutShortAt };
}

function metered(run: CronRun): { run: CronRun; meter: MeteredDatabase } {
  if (run.meter !== undefined) return { run, meter: run.meter };
  const meter = meterDatabase(run.env.DB);
  return { run: { ...run, env: { ...run.env, DB: meter.db }, meter }, meter };
}

/**
 * A whole scheduled run: the jobs, then the heartbeat that tells the outside monitor the cron is running. It pings
 * /fail when a job failed, or when the run before never finished, saying so; with nothing wrong, it pings only when
 * `pingWhenWell` (pingsWhenWell, src/scheduled/schedule.ts).
 */
export async function runCron(jobs: readonly CronJob[], run: CronRun, pingWhenWell = true): Promise<void> {
  const { outcomes, cutShortAt } = await runJobs(jobs, run);
  const notFinished = cutShortAt === null ? [] : [`the run started at ${cutShortAt} never finished`];
  const wrong = [...notFinished, ...failedJobs(outcomes)];
  if (wrong.length === 0 && !pingWhenWell) return;
  const heartbeat = { url: run.config.settings.heartbeatUrl, fetch: run.deps.fetch, log: run.log };
  await pingHeartbeat(heartbeat, wrong);
}

function failedJobs(outcomes: readonly CronOutcome[]): string[] {
  return outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.job);
}

/**
 * Keeping the run record must never stop the jobs, so a failure to is only logged. The alert providers are made only
 * if a run was cut short: making them on every run cost each one CPU time.
 */
async function recordStart({ env, deps, log }: CronRun, startedAt: string): Promise<RunStart> {
  try {
    return await startRun({ db: env.DB, alertOnce: (alert) => deps.alertOnce(alert) }, startedAt);
  } catch (error) {
    log.error("cron_run_not_recorded", { error });
    return { cutShortAt: null, failing: new Set() };
  }
}

async function recordFinish({ env, deps, log }: CronRun, startedAt: string, failedJobCount: number): Promise<void> {
  const run = { startedAt, completedAt: deps.now().toISOString(), failedJobs: failedJobCount };
  try {
    await finishRun({ db: env.DB, resolveAlert: (key) => deps.resolveAlert(key) }, run);
  } catch (error) {
    log.error("cron_run_not_recorded", { error });
  }
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
