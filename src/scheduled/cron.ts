// The five-minute cron (wrangler.jsonc "triggers"): every job below, in this
// order. A job that throws is logged as `cron_job_failed` and the next one runs
// anyway, so one failing job never stops the others. runCronJobs returns each
// job's outcome, for alerting on a job that keeps failing.

import type { Dependencies } from "../dependencies.ts";
import { resolveAskedWindows } from "../domain/asked-windows.ts";
import { requeueUnbookedHolds } from "../domain/bookings.ts";
import { syncBooks } from "../domain/books-sync.ts";
import { alertAgedDeletions } from "../domain/deletion.ts";
import { recordUtilisation } from "../domain/dispatch.ts";
import { deleteLeftFiles } from "../domain/erasure.ts";
import { raiseInvoices } from "../domain/fsm-invoices.ts";
import { queueReminders } from "../domain/visit-messages.ts";
import type { StaticConfig } from "../guard.ts";
import type { Logger } from "../log.ts";
import type { MessagingMessage } from "../queues/messaging.ts";
import { reconcileFsm } from "./reconcile-fsm.ts";
import { referralPass } from "./referrals.ts";
import { sweep } from "./sweeper.ts";

export interface CronContext {
  readonly env: Env;
  readonly deps: Dependencies;
  readonly config: StaticConfig;
  /** Carries the job's name on every line. */
  readonly log: Logger;
}

/** What a job needs switched on in this environment before it runs. */
type Needs = "nothing" | "fsm" | "fsm_and_books" | "messaging";

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

async function sweepJob({ env, deps, config, log }: CronContext): Promise<void> {
  await sweep(env, deps, log, {
    creditFloor: config.settings.tryon.creditFloor,
    fsmErasure: config.providers.FSM_PROVIDER !== "none",
  });
}

async function unbookedHoldsJob({ env, deps, log }: CronContext): Promise<void> {
  const requeued = await requeueUnbookedHolds(env.DB, env.FSM_QUEUE, deps.now(), deps.alert);
  if (requeued > 0) log.warn("unbooked_holds_requeued", { count: requeued });
}

async function erasedFilesJob({ env, deps, log }: CronContext): Promise<void> {
  const finished = await deleteLeftFiles(env, deps.now(), log);
  if (finished > 0) log.info("erased_files_deleted", { people: finished });
}

async function reconcileJob({ env, deps, log }: CronContext): Promise<void> {
  await reconcileFsm(env, deps, log);
}

async function deletionAlertsJob({ env, deps }: CronContext): Promise<void> {
  await alertAgedDeletions(env.DB, deps.now(), deps.alert);
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

async function invoicesJob({ env, deps, log }: CronContext): Promise<void> {
  const done = await raiseInvoices(env.DB, deps.fsm, deps.books, deps.now(), log, deps.alert);
  if (done.raised + done.issued > 0) log.info("invoices_raised", done);
}

async function askedWindowsJob({ env, deps, log }: CronContext): Promise<void> {
  const done = await resolveAskedWindows(env.DB, deps.fsm, deps.now(), log);
  if (done.resolved > 0) log.info("asked_windows_resolved", done);
}

async function booksJob({ env, deps, config, log }: CronContext): Promise<void> {
  const options = {
    refundAccountId: config.settings.zohoFsm?.booksRefundAccountId ?? null,
    labelAsTest: config.environment !== "production",
  };
  const done = await syncBooks(env.DB, deps.fsm, deps.books, options, deps.now(), log);
  if (done.recorded + done.applied + done.refunded > 0) log.info("books_synced", done);
}

export const CRON_JOBS: readonly CronJob[] = [
  { name: "sweeper", needs: "nothing", run: sweepJob },
  // A hold paid for and neither booked nor refunded half an hour on (docs/decisions/0067-a-paid-hold-is-kept.md).
  { name: "unbooked_holds", needs: "fsm", run: unbookedHoldsJob },
  // What an erasure could not delete from R2 at the time (docs/decisions/0066-erasure-all-or-nothing.md).
  { name: "erased_files", needs: "nothing", run: erasedFilesJob },
  // The FSM mirror's repair (docs/decisions/0032-fsm-mirror.md).
  { name: "fsm_reconcile", needs: "fsm", run: reconcileJob },
  { name: "deletion_alerts", needs: "nothing", run: deletionAlertsJob },
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

/** Runs each job switched on here, in order, each under a logger named for it. */
export async function runCronJobs(jobs: readonly CronJob[], context: CronContext): Promise<CronOutcome[]> {
  const outcomes: CronOutcome[] = [];
  for (const job of jobs) {
    if (!isSwitchedOn(job.needs, context.config)) continue;
    const log = context.log.child({ job: job.name });
    try {
      await job.run({ ...context, log });
      outcomes.push({ job: job.name, ok: true });
    } catch (error) {
      log.error("cron_job_failed", { error });
      outcomes.push({ job: job.name, ok: false });
    }
  }
  return outcomes;
}
