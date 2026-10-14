// The cron's jobs (wrangler.jsonc "triggers"): a run every minute, each running only the jobs due in that minute.
// CRON_JOBS gives each how often it runs (`every`) and in which minute of that period (`at`), and a job that does a
// day's or a week's work in one hour its `slot`, from which it is due until it has run well (./schedule.ts).
//
// ./cron-runner.ts runs them, each under its own lease, so one slow job holds only itself; a job that throws is
// counted, and three in a row alert (docs/decisions/0067-alerts-and-silent-failures.md, 0195-the-cron-a-job-at-a-
// time.md). A daily or weekly job that has not run well for its period and two hours more is told as missed.
//
// The jobs of a run share one budget of outside calls (CRON_CALLS, src/lib/call-budget.ts), which keeps the cron under
// the vendors' own limits. Their statements to D1 are kept by each job's batch sizes, well under the 1,000 an
// invocation may send (docs/decisions/0112-workers-paid.md).

import { BOOKS_BILL_ACCOUNTS, BOOKS_ITEM_PUSH, OPS_ORIGIN } from "../config/environments.ts";
import { NO_GST, type GstRegistration } from "../config/gst.ts";
import type { Dependencies } from "../dependencies.ts";
import { bookUnbookedHolds } from "../domain/booking/unbooked-holds.ts";
import { eraseBooksCustomers } from "../domain/books/books-erasure.ts";
import { raiseBooksInvoices } from "../domain/books/books-invoices.ts";
import { checkBooksItems } from "../domain/books/books-items.ts";
import { syncBooks } from "../domain/books/books-sync.ts";
import type { BooksSyncOptions } from "../domain/books/books-pass.ts";
import { closeStaleLowStock } from "../domain/inventory/low-stock.ts";
import { settleOwedRefunds } from "../domain/money/cancel-refunds.ts";
import { settleOwedNoShowRefunds } from "../domain/no-shows/after-a-ruling.ts";
import { retellUndelivered } from "../domain/platform/alerts.ts";
import { tellOfExpiring, tellOfOverdue } from "../domain/inventory/stock-watch.ts";
import { refreshStockRisks } from "../domain/inventory/stock-risks.ts";
import { measureLastForecast } from "../domain/purchasing/forecast-accuracy.ts";
import { runForecastIfDue } from "../domain/purchasing/forecast.ts";
import { draftPlan } from "../domain/purchasing/supply-plan.ts";
import { checkTomorrowsKits } from "../domain/inventory/kit-check.ts";
import { raiseCountTasks } from "../domain/inventory/cycle-counts.ts";
import { classDaysOf } from "../policy/cycle-counts.ts";
import { jobsLastWell } from "../domain/platform/cron-runs.ts";
import { alertAgedDeletions } from "../domain/privacy/deletion.ts";
import { recordUtilisation } from "../domain/dispatch/dispatch-utilisation.ts";
import { deleteLeftFiles } from "../domain/privacy/erasure-files.ts";
import { tellOfNewGrievances } from "../domain/ops/grievances.ts";
import { queueCreditReminders } from "../domain/money/credit-reminders.ts";
import { queueNextServiceReminders } from "../domain/visits/next-visit.ts";
import { sendUnsentLinks } from "../domain/money/payment-links.ts";
import type { OpsInputs } from "../domain/platform/ops-settings.ts";
import { readDatabaseBytes, tellOfDatabaseSize, tellOfStorage } from "../domain/platform/storage-meter.ts";
import { queueReminders } from "../domain/messages/visit-messages.ts";
import type { StaticConfig } from "../guard.ts";
import type { CallBudget } from "../lib/call-budget.ts";
import type { MeteredDatabase } from "../lib/d1-meter.ts";
import type { Logger } from "../log.ts";
import { enqueue, enqueueBatch } from "../domain/platform/enqueue.ts";
import { analyticsJob } from "./analytics.ts";
import { razorpayCatchUpJob } from "./razorpay-catch-up.ts";
import { referralPass } from "./referrals.ts";
import { retentionJob } from "./retention.ts";
import { taskSpansJob } from "./task-spans.ts";
import {
  checkYoucamUnits,
  deletePhotos,
  expireTryOns,
  deleteExpiredRecords,
  letKeptLooksGo,
  requeueCrmErasures,
  requeueLeads,
  requeueMessages,
  requeueTryons,
} from "./sweeper.ts";
import { missedAfterMs, type Slot, type Timing } from "./schedule.ts";
import { indiaDate } from "../lib/india-time.ts";
import { checkWhatsAppBridge } from "./whatsapp-bridge.ts";
import { startOrFollow } from "../workflows/steps.ts";
import { type MessagingMessage } from "../config/pipeline.ts";
import { tellOfUnassignedToday } from "../domain/dispatch/unassigned.ts";
import { queueFollowUps } from "../domain/visits/follow-ups.ts";
import { cityReminderHours, type ReminderHours } from "../domain/cities/city-rules.ts";

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
  /** For a job held to a slot, the slot it runs for: when it began, and India's date then. */
  readonly slot?: { readonly start: Date; readonly date: string } | undefined;
}

/** The fits booked ahead with no hair system in reach, kept as tasks each hour (src/domain/inventory/stock-risks.ts). */
async function stockRisksJob({ env, deps, inputs }: CronContext): Promise<void> {
  const now = deps.now();
  await refreshStockRisks(env.DB, indiaDate(now), now, (await inputs()).stockWatch.demand_days);
}

/** How right the last forecast was, once its first period has passed (src/domain/purchasing/forecast-accuracy.ts). */
const forecastAccuracyJob = ({ env, deps }: CronContext) =>
  measureLastForecast(env.DB, deps.now(), indiaDate(deps.now()));

/** Once each planning period: the demand forecast, and the supply plan drafted from it. */
async function forecastJob({ env, deps, inputs }: CronContext): Promise<void> {
  const now = deps.now();
  const given = await inputs();
  const run = await runForecastIfDue(env.DB, now, given);
  if (run !== null) await draftPlan(env.DB, run, now, given.planningPeriodDays);
}

/** Each evening hour: tomorrow's kits, and their top-ups (src/domain/inventory/kit-check.ts). */
const kitCheckJob = async ({ env, deps, inputs }: CronContext) =>
  checkTomorrowsKits(env.DB, deps.now(), deps.alertOnce, (await inputs()).kitCheck);

/** The morning's cycle counts (src/domain/inventory/cycle-counts.ts). */
const cycleCountsJob = async ({ env, deps, inputs, slot }: CronContext) =>
  raiseCountTasks(env.DB, slot?.date ?? indiaDate(deps.now()), deps.now(), classDaysOf((await inputs()).cycleCounts));

/** The morning's stock that expires soon, and transfers long on their way (src/domain/inventory/stock-watch.ts). */
const expiringStockJob = async ({ env, deps, inputs, slot }: CronContext) =>
  tellOfExpiring(env.DB, deps, slot?.date ?? indiaDate(deps.now()), (await inputs()).stockWatch.expiry_warning_days);
const overdueTransfersJob = async ({ env, deps, inputs }: CronContext) =>
  tellOfOverdue(env.DB, deps, deps.now(), (await inputs()).stockWatch.transfer_overdue_days);

/**
 * A job held to a slot that has not run well for its period and two hours more, told once (./schedule.ts). Its next
 * run that goes well closes it (./cron-runner.ts).
 */
async function missedJobsJob({ env, deps, config }: CronContext): Promise<void> {
  const now = deps.now().getTime();
  const lastWell = await jobsLastWell(env.DB);
  for (const job of CRON_JOBS) {
    if (job.slot === undefined || !isSwitchedOn(job.needs, config)) continue;
    const since = lastWell.get(job.name);
    if (since === undefined || now - Date.parse(since) <= missedAfterMs(job.slot)) continue;
    await deps.alertOnce({
      key: `cron_job_missed:${job.name}`,
      message: `The cron's ${job.name} job has not run well since ${since}, past its time: runbook, "Alerts and the cron".`,
    });
  }
}
const unassignedToday = ({ env, deps }: CronContext) => tellOfUnassignedToday(env.DB, deps);

/** What a run is given; the budget and the figures ops set are the run's own, shared by its jobs. */
export type CronRun = Omit<CronContext, "budget" | "inputs" | "slot"> & {
  /**
   * The meter env.DB already reads through, which the run's dependencies were made with too. Without one the run
   * meters env.DB itself, and what its dependencies read (an alert raised or closed) goes uncounted.
   */
  readonly meter?: MeteredDatabase;
  /** The outside calls the run may make; CRON_CALLS when not given. */
  readonly calls?: number;
};

/** What a job needs switched on in this environment before it runs. */
type Needs = "nothing" | "books" | "messaging" | "payments";

/** A job, and when it runs (src/scheduled/schedule.ts). */
export interface CronJob extends Timing {
  readonly name: string;
  readonly needs: Needs;
  /** For a job that does a day's or a week's work in one hour: due from then until it has run well. */
  readonly slot?: Slot;
  readonly run: (context: CronContext) => Promise<unknown>;
}

export function isSwitchedOn(needs: Needs, config: StaticConfig): boolean {
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

/** Refunds a request owed and did not settle: a cancel's, then a no-show ruling's. */
async function cancelRefundsJob({ env, deps, log, budget }: CronContext): Promise<void> {
  const settled = await settleOwedRefunds(env.DB, { ...deps, budget, log }, deps.now());
  if (settled > 0) log.warn("cancel_refunds_settled", { count: settled });
  const noShows = await settleOwedNoShowRefunds(env.DB, { ...deps, budget }, deps.now());
  if (noShows > 0) log.warn("no_show_refunds_settled", { count: noShows });
}

async function erasedFilesJob({ env, deps, log }: CronContext): Promise<void> {
  const finished = await deleteLeftFiles(env, deps.now(), log);
  if (finished > 0) log.info("erased_files_deleted", { people: finished });
}

async function booksErasuresJob({ env, deps, log, budget }: CronContext): Promise<void> {
  const erased = await eraseBooksCustomers(env.DB, { ...deps, log, budget }, deps.now());
  if (erased > 0) log.info("books_customers_erased", { count: erased });
}

/** An alert whose first telling the chat did not take, told again (src/domain/platform/alerts.ts). */
async function alertsRetoldJob({ env, deps, config, log }: CronContext): Promise<void> {
  const told = await retellUndelivered({
    db: env.DB,
    alert: deps.alert,
    now: deps.now,
    environment: config.environment,
    log,
  });
  if (told > 0) log.info("alerts_retold", { told });
}

const deletionAlertsJob = ({ env, deps }: CronContext) => alertAgedDeletions(env.DB, deps.now(), deps.alertOnce);

const grievanceAlertsJob = ({ env, deps, config }: CronContext) =>
  tellOfNewGrievances(env.DB, deps.alert, `${OPS_ORIGIN[config.environment]}/grievances`, deps.now());

/** R2's share and the database fill over months, so an hourly look is enough. */
async function storageMeterJob({ env, deps, config }: CronContext): Promise<void> {
  await tellOfStorage(env.DB, deps.alertOnce, config.environment, deps.now());
  await tellOfDatabaseSize(env.DB, deps.alertOnce, await readDatabaseBytes(env.DB));
}

/**
 * The weekly backup, due from 3 am on Sundays in India: it starts the week's Workflow (src/workflows/backup.ts), named
 * for the Sunday, or follows the one started, and is done once that has finished. No key to encrypt to, outside a
 * local run, alerts at once.
 */
async function backupJob({ env, deps, config, slot }: CronContext): Promise<unknown> {
  const date = slot?.date ?? indiaDate(deps.now());
  if (config.settings.backupPublicKey === null) {
    if (config.environment !== "local") {
      await deps.alertOnce({
        key: "backup_not_configured",
        message: "No weekly backup was written: no backup key is set. The runbook, Restoring D1, says how to make one.",
      });
    }
    return undefined;
  }
  return startOrFollow(env.BACKUP_RUN, { id: `backup-${date}`, params: { date } });
}

/** A low-stock alert whose consumable was retired since, or whose retirement came round, closes. */
const lowStockJob = ({ env, deps }: CronContext) => closeStaleLowStock(env.DB, deps);

const whatsAppBridgeJob = ({ deps, log, budget }: CronContext) => checkWhatsAppBridge(deps, log, budget);

/** Records yesterday's figure on the first run of the day; the day's later runs find it recorded. */
async function utilisationJob({ env, deps, log }: CronContext): Promise<void> {
  const date = await recordUtilisation(env.DB, deps.now());
  if (date !== null) log.info("dispatch_utilisation_recorded", { date });
}

async function referralsJob({ env, deps, log, inputs }: CronContext): Promise<void> {
  const messages = await referralPass(env.DB, deps.now(), log, (await inputs()).referralReward);
  await queueMessages({ env, log }, messages, "referrals");
}

/** The reminder hour, with the hours of the cities that set their own (src/domain/cities/city-rules.ts). */
async function hoursOf(db: D1Database, national: number): Promise<ReminderHours> {
  return { national, cities: await cityReminderHours(db) };
}

async function remindersJob({ env, deps, log, inputs }: CronContext): Promise<void> {
  const now = deps.now();
  const reminders = await queueReminders(env.DB, now, await hoursOf(env.DB, (await inputs()).reminderHour));
  await queueMessages({ env, log }, reminders, "reminders");
  if (reminders.length > 0) log.info("visit_reminders_queued", { count: reminders.length });
}

async function nextServiceRemindersJob({ env, deps, log, inputs }: CronContext): Promise<void> {
  const now = deps.now();
  const { nextVisitDays, reminderHour } = await inputs();
  const reminders = await queueNextServiceReminders(env.DB, now, nextVisitDays, await hoursOf(env.DB, reminderHour));
  await queueMessages({ env, log }, reminders, "next-service-reminders");
  if (reminders.length > 0) log.info("next_service_reminders_queued", { count: reminders.length });
}

/** What follows a visit, once a visit, from the reminder hour (src/domain/visits/follow-ups.ts). */
async function followUpsJob({ env, deps, log, inputs }: CronContext): Promise<void> {
  const { checkInDays, reminderHour } = await inputs();
  const followUps = await queueFollowUps(env.DB, deps.now(), checkInDays, await hoursOf(env.DB, reminderHour));
  await queueMessages({ env, log }, followUps, "follow-ups");
}

async function creditRemindersJob({ env, deps, log, inputs }: CronContext): Promise<void> {
  const { reminderHour, creditReminderDays } = await inputs();
  const reminders = await queueCreditReminders(env.DB, deps.now(), reminderHour, creditReminderDays);
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
  const done = await raiseBooksInvoices({ db: env.DB, deps, options, now: deps.now(), log, budget });
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
    billAccounts: BOOKS_BILL_ACCOUNTS[config.environment],
    labelAsTest: config.environment !== "production",
    gst: booksGst(config),
  };
}

/** The GST registration Books carries here; none where Books is not Zoho's. */
function booksGst(config: StaticConfig): GstRegistration {
  return config.settings.zohoBooks?.gst ?? NO_GST;
}

async function booksJob({ env, deps, config, log, budget }: CronContext): Promise<void> {
  const done = await syncBooks({ db: env.DB, deps, options: booksSyncOptions(config), now: deps.now(), log, budget });
  const written = Object.values(done).reduce((sum, count) => sum + count, 0);
  if (written > 0) log.info("books_synced", done);
}

const youcamUnitsJob = (context: CronContext) => checkYoucamUnits(context, context.config.settings.tryon.unitFloor);

/**
 * Every job, and when it runs (src/scheduled/schedule.ts): every `every` minutes, at minute `at` of each such stretch.
 * The jobs a minute calls run in this order.
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
  { name: "alerts_retold", needs: "nothing", every: 5, at: 4, run: alertsRetoldJob },

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
  // nothing after the hour's first five minutes (src/domain/books/books-items.ts), so it runs in one of them.
  { name: "books_items", needs: "books", every: 60, at: 4, run: booksItemsJob },
  { name: "expire_tryons", needs: "nothing", every: 60, at: 9, run: expireTryOns },
  { name: "youcam_units", needs: "nothing", every: 60, at: 14, run: youcamUnitsJob },
  { name: "kept_looks", needs: "nothing", every: 60, at: 19, run: letKeptLooksGo },
  { name: "deletion_alerts", needs: "nothing", every: 60, at: 24, run: deletionAlertsJob },
  // The stock, a step a job, so one that throws stops none of the others; the morning's from 9 am in India.
  { name: "stock_risks", needs: "nothing", every: 60, at: 44, run: stockRisksJob },
  { name: "forecast_accuracy", needs: "nothing", every: 60, at: 44, run: forecastAccuracyJob },
  { name: "forecast", needs: "nothing", every: 60, at: 44, run: forecastJob },
  { name: "kit_check", needs: "nothing", every: 60, at: 44, run: kitCheckJob },
  { name: "cycle_counts", needs: "nothing", every: 60, at: 44, slot: { hour: 9 }, run: cycleCountsJob },
  { name: "expiring_stock", needs: "nothing", every: 60, at: 44, slot: { hour: 9 }, run: expiringStockJob },
  { name: "overdue_transfers", needs: "nothing", every: 60, at: 44, slot: { hour: 9 }, run: overdueTransfersJob },
  { name: "missed_jobs", needs: "nothing", every: 60, at: 34, run: missedJobsJob },
  // The grievances raised in the hour, in one message, so one client cannot flood the chat.
  { name: "grievance_alerts", needs: "nothing", every: 60, at: 24, run: grievanceAlertsJob },
  { name: "housekeeping", needs: "nothing", every: 60, at: 28, run: deleteExpiredRecords },
  // An erased client's customer in Books, deleted, or blanked where an invoice names it.
  { name: "books_erasures", needs: "books", every: 60, at: 29, run: booksErasuresJob },
  // What the photographs and cards hold of R2, told at half, 80% and all of their share (docs/decisions/0093), and
  // the database against D1's limit, told at half, 80% and 95%.
  { name: "storage_meter", needs: "nothing", every: 60, at: 39, run: storageMeterJob },
  // Due from 3 am on Sundays in India, and caught up hourly until it is written.
  { name: "backup", needs: "nothing", every: 60, at: 33, slot: { hour: 3, weekday: 0 }, run: backupJob },
  // The nightly copy Zoho Analytics reports from (docs/decisions/0146-the-nightly-analytics-copy.md).
  { name: "analytics_nightly", needs: "nothing", every: 60, at: 31, slot: { hour: 3 }, run: analyticsJob },
  // When each task opened and closed, for the reporting copy (docs/decisions/0147-task-spans.md).
  { name: "task_spans", needs: "nothing", every: 60, at: 26, slot: { hour: 23 }, run: taskSpansJob },
  // The operating figure behind the weekend-share assumption (src/policy/dispatch.ts): once a day, the day's board.
  { name: "dispatch_utilisation", needs: "nothing", every: 60, at: 43, run: utilisationJob },
  // A visit today with no technician, told each hour until someone is sent (src/domain/dispatch/unassigned.ts).
  { name: "unassigned_today", needs: "nothing", every: 60, at: 46, run: unassignedToday },
  { name: "low_stock", needs: "nothing", every: 60, at: 50, run: lowStockJob },
  // The next service falling due with nothing booked (docs/decisions/0086-the-next-visit-is-offered.md).
  { name: "next_service_reminders", needs: "messaging", every: 60, at: 44, run: nextServiceRemindersJob },
  { name: "follow_ups", needs: "messaging", every: 60, at: 47, run: followUpsJob },
  // Free service visits running out: a month, then a week, before their last day.
  { name: "credit_reminders", needs: "messaging", every: 60, at: 49, run: creditRemindersJob },
  // What the retention periods let go of: dormant people who never became clients, old check-in coordinates, and the
  // waitlist of areas launched a year ago (src/policy/retention.ts).
  { name: "retention", needs: "nothing", every: 60, at: 53, run: retentionJob },
  // What an erasure could not delete from R2 at the time (docs/decisions/0066-erasure-all-or-nothing.md).
  { name: "erased_files", needs: "nothing", every: 60, at: 59, run: erasedFilesJob },
  { name: "requeue_crm_erasures", needs: "nothing", every: 60, at: 59, run: requeueCrmErasures },
];
