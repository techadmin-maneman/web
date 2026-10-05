// The sweeper's steps. D1 is the replay source: anything that should have moved on and has not is put back on its
// queue from here. Each step is a cron job of its own, so one that fails skips none of the others; the cron's table
// says how often each runs (src/scheduled/cron.ts).
//
//   leads       pending over 2 minutes, or failed under 10 attempts   -> crm-sync
//   erasures    a person erased whose CRM record is not yet blanked     -> crm-sync
//   messages    queued but unsent 5 minutes after it was due, while WhatsApp is up -> messaging, a paced one paced again
//               and failed after a day (src/scheduled/unsent-messages.ts)
//   renders     queued but never started, or rendering past the give-up time -> render
//   downloads   a stored result URL not yet fetched, until it expires  -> render
//   credits     the AILabTools balance, against AILAB_CREDIT_FLOOR
//   expiry      abandoned uploads after an hour, results once RESULT_RETENTION_DAYS is up (14 in production,
//               3 on staging), photos once their jobs are done; a client's try-on is kept on its look's day, and
//               any other photo's small copy goes with the photo or the look (docs/decisions/0084)
//   kept looks  a client's kept look once their first fit is photographed
//   cleanup     idempotency keys after a day, login codes a day past expiry, rate counters after 3 days,
//               try-on sessions once expired, app sessions 30 days after they ended, and holds nobody is paying for

import { lettingGo } from "../domain/scheduling.ts";
import { DOWNLOAD_QUEUE_RETRIES, RENDER_GIVE_UP_MS } from "../config/pipeline.ts";
import { PHOTO_RETENTION_MS } from "../config/tryon.ts";
import type { Dependencies } from "../dependencies.ts";
import { keepOrLetGo, letCopiesGoWith, letFittedLooksGo, type ExpiringTryOn } from "../domain/kept-try-ons.ts";
import { failJob } from "../domain/tryon.ts";
import type { CallBudget } from "../lib/call-budget.ts";
import { addDays, indiaDate } from "../lib/india-time.ts";
import type { Logger } from "../log.ts";
import { enqueueBatch } from "../domain/enqueue.ts";
import type { RenderMessage } from "../queues/render.ts";
import { requeueUnsentMessages } from "./unsent-messages.ts";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "../lib/durations.ts";
import { MAX_SYNC_ATTEMPTS, type CrmSyncMessage } from "../config/pipeline.ts";

/** A pending lead, or a queued job, older than this has lost its queue message. */
const PENDING_GRACE_MS = 2 * MINUTE_MS;
/** A submit that started this long ago and never recorded a task died part-way. */
const SUBMIT_ABANDONED_MS = 10 * MINUTE_MS;
/** Downloads are retried every sweep at first, then hourly until the URL expires. */
const DOWNLOAD_RETRY_EARLY_MS = 5 * MINUTE_MS;
const DOWNLOAD_RETRY_LATE_MS = HOUR_MS;
const DOWNLOAD_EARLY_ATTEMPTS = DOWNLOAD_QUEUE_RETRIES + 3;
/** Most rows handled per kind per run; the next run takes the rest. */
const BATCH_LIMIT = 100;
/**
 * Most looks past their day expired a run. Keeping a client's on its day costs about eight calls to D1 and R2
 * (src/domain/kept-try-ons.ts), and a run may make 1,000 such calls in all (src/lib/call-budget.ts): 40 of them take
 * about 320, and the next run takes the rest.
 */
const EXPIRY_BATCH = 40;
const IDEMPOTENCY_TTL_MS = DAY_MS;
/** Rate-limit windows are at most a day; keep two more for inspection. */
const COUNTER_RETENTION_DAYS = 3;
/** A login code is kept a day past its expiry, for the logs to be read against; a session 30 days past its end. */
const CHALLENGE_RETENTION_MS = DAY_MS;
const SESSION_RETENTION_MS = 30 * DAY_MS;

export type SweepEnv = Pick<
  Env,
  "DB" | "CRM_QUEUE" | "RENDER_QUEUE" | "MESSAGE_QUEUE" | "UPLOADS" | "RESULTS" | "CLIENT_PHOTOS"
>;

interface SweepSummary {
  readonly leadsRequeued: number;
  readonly erasuresRequeued: number;
  readonly messagesRequeued: number;
  readonly rendersRequeued: number;
  readonly downloadsRequeued: number;
  readonly jobsExpired: number;
  readonly photosDeleted: number;
  /** Clients' try-ons kept on their looks' day, and kept looks let go once the first fit was photographed. */
  readonly tryOnsKept: number;
  readonly keptLooksDeleted: number;
}

/** What each step is given: the cron run's own, or a test's. */
interface SweepContext {
  readonly env: SweepEnv;
  readonly deps: Dependencies;
  readonly log: Logger;
  /** The cron run's outside calls. */
  readonly budget: CallBudget;
}

/** One step's run: where it writes, what it calls, and the moment it counts from. */
interface SweepRun {
  readonly env: SweepEnv;
  readonly db: D1Database;
  readonly deps: Dependencies;
  readonly log: Logger;
  readonly now: Date;
  /** The instant `ms` before now, as ISO. */
  readonly before: (ms: number) => string;
}

function sweepRun({ env, deps, log }: SweepContext): SweepRun {
  const now = deps.now();
  return { env, db: env.DB, deps, log, now, before: (ms: number) => new Date(now.getTime() - ms).toISOString() };
}

/** A step says what it did only when it did something, so a quiet minute writes no line. */
function logCount(log: Logger, event: string, count: number): void {
  if (count > 0) log.info(event, { count });
}

/**
 * Every step but the balance check, in the order a sweep once ran them in one pass. The cron runs each as a job of its
 * own; tests run them together through this.
 */
export async function sweep(
  env: SweepEnv,
  deps: Dependencies,
  log: Logger,
  options: { readonly budget: CallBudget },
): Promise<SweepSummary> {
  const context: SweepContext = { env, deps, log, budget: options.budget };
  const leads = await requeueLeads(context);
  const erasures = await requeueCrmErasures(context);
  const messages = await requeueMessages(context);
  const { renders, downloads } = await requeueTryons(context);
  const { expired: jobsExpired, kept: tryOnsKept } = await expireTryOns(context);
  const photosDeleted = await deletePhotos(context);
  const keptLooksDeleted = await letKeptLooksGo(context);
  await housekeep(context);
  return {
    leadsRequeued: leads.length,
    erasuresRequeued: erasures.length,
    messagesRequeued: messages.length,
    rendersRequeued: renders.length,
    downloadsRequeued: downloads.length,
    jobsExpired,
    photosDeleted,
    tryOnsKept,
    keptLooksDeleted,
  };
}

/** Leads that have not reached the CRM, sent to crm-sync again. */
export async function requeueLeads(context: SweepContext): Promise<string[]> {
  const { db, env, before, log } = sweepRun(context);
  const leads = await ids(
    db
      .prepare(
        `SELECT id FROM leads
       WHERE (sync_state = 'pending' AND created_at < ?1) OR (sync_state = 'failed' AND sync_attempts < ?2)
       ORDER BY created_at LIMIT ?3`,
      )
      .bind(before(PENDING_GRACE_MS), MAX_SYNC_ATTEMPTS, BATCH_LIMIT),
  );
  await sendAll(
    env.CRM_QUEUE,
    leads.map((id) => ({ lead_id: id, request_id: "sweeper" }) satisfies CrmSyncMessage),
    log,
  );
  logCount(log, "leads_requeued", leads.length);
  return leads;
}

/** Erased people whose CRM record is still to be blanked, sent to crm-sync again. */
export async function requeueCrmErasures(context: SweepContext): Promise<string[]> {
  const { db, env, before, log } = sweepRun(context);
  const erasures = await ids(
    db
      .prepare(
        `SELECT id FROM people
       WHERE erased_at < ?1 AND crm_erased_at IS NULL AND crm_erasure_attempts < ?2
       ORDER BY erased_at LIMIT ?3`,
      )
      .bind(before(PENDING_GRACE_MS), MAX_SYNC_ATTEMPTS, BATCH_LIMIT),
  );
  await sendAll(
    env.CRM_QUEUE,
    erasures.map((id) => ({ erase_person_id: id, request_id: "sweeper" }) satisfies CrmSyncMessage),
    log,
  );
  logCount(log, "crm_erasures_requeued", erasures.length);
  return erasures;
}

/** Messages queued and never sent, sent to messaging again while the bridge is open (src/scheduled/unsent-messages.ts). */
export async function requeueMessages(context: SweepContext): Promise<string[]> {
  const { env, deps, log, now } = sweepRun(context);
  const messages = await requeueUnsentMessages({
    db: env.DB,
    queue: env.MESSAGE_QUEUE,
    deps,
    log,
    now,
    budget: context.budget,
  });
  logCount(log, "messages_requeued", messages.length);
  return messages;
}

/** Try-on renders and downloads whose queue message was lost, sent to render again; ones past saving failed. */
export async function requeueTryons(
  context: SweepContext,
): Promise<{ renders: string[]; abandoned: string[]; downloads: string[]; lost: string[] }> {
  const { db, env, now, before, deps, log } = sweepRun(context);
  // The four lookups go in one round trip: each trip to D1 costs the cron run CPU time.
  const [renders = [], abandoned = [], downloads = [], lost = []] = await idsOfEach(db, [
    // Renders whose queue message was lost: never started, or silent past the give-up time.
    db
      .prepare(
        `SELECT id FROM tryon_jobs
       WHERE (state = 'queued' AND submit_started_at IS NULL AND created_at < ?1)
          OR (state = 'rendering' AND submitted_at < ?2)
       ORDER BY created_at LIMIT ?3`,
      )
      .bind(before(PENDING_GRACE_MS), before(RENDER_GIVE_UP_MS + PENDING_GRACE_MS), BATCH_LIMIT),
    // A submit that started and never finished cannot be resumed: we do not know whether AILabTools took it.
    db
      .prepare(
        "SELECT id FROM tryon_jobs WHERE state = 'queued' AND submit_started_at < ?1 AND provider_task_id IS NULL LIMIT ?2",
      )
      .bind(before(SUBMIT_ABANDONED_MS), BATCH_LIMIT),
    // Paid results not yet downloaded: retried until their URL expires, then lost.
    db
      .prepare(
        `SELECT id FROM tryon_jobs
       WHERE state = 'downloading' AND provider_result_expires_at > ?1
         AND (download_attempted_at IS NULL
              OR (download_attempts < ?2 AND download_attempted_at < ?3)
              OR download_attempted_at < ?4)
       ORDER BY created_at LIMIT ?5`,
      )
      .bind(
        now.toISOString(),
        DOWNLOAD_EARLY_ATTEMPTS,
        before(DOWNLOAD_RETRY_EARLY_MS),
        before(DOWNLOAD_RETRY_LATE_MS),
        BATCH_LIMIT,
      ),
    db
      .prepare("SELECT id FROM tryon_jobs WHERE state = 'downloading' AND provider_result_expires_at <= ?1 LIMIT ?2")
      .bind(now.toISOString(), BATCH_LIMIT),
  ]);
  for (const id of abandoned) await failJob(db, id, "render_failed", "submit did not finish", now);
  for (const id of lost) {
    if (await failJob(db, id, "render_failed", "result URL expired before download", now)) {
      await deps.alert(`Try-on job ${id}: its result was billed but never downloaded, and its URL has expired.`);
    }
  }
  await sendAll(
    env.RENDER_QUEUE,
    [...renders, ...downloads].map((id) => ({ job_id: id, request_id: "sweeper" }) satisfies RenderMessage),
    log,
  );
  logCount(log, "renders_requeued", renders.length);
  logCount(log, "downloads_requeued", downloads.length);
  logCount(log, "submits_abandoned", abandoned.length);
  logCount(log, "results_lost", lost.length);
  return { renders, abandoned, downloads, lost };
}

/** Deletes what has outlived its use: idempotency keys, counters, sessions and spent codes; lets dead holds go. */
export async function housekeep(context: SweepContext): Promise<void> {
  const { db, now, before } = sweepRun(context);
  const sessionsEnded = before(SESSION_RETENTION_MS);
  await db.batch([
    db.prepare("DELETE FROM idempotency WHERE created_at < ?1").bind(before(IDEMPOTENCY_TTL_MS)),
    db.prepare("DELETE FROM counters WHERE window_start < ?1").bind(addDays(indiaDate(now), -COUNTER_RETENTION_DAYS)),
    db.prepare("DELETE FROM tryon_sessions WHERE expires_at < ?1").bind(now.toISOString()),
    db.prepare("DELETE FROM otp_challenges WHERE expires_at < ?1").bind(before(CHALLENGE_RETENTION_MS)),
    db.prepare("DELETE FROM number_codes WHERE expires_at < ?1").bind(before(CHALLENGE_RETENTION_MS)),
    // A technician's phone keeps pointing at the last session it logged in with,
    // so it lets go of that session before the session is deleted.
    db
      .prepare(
        `UPDATE technician_devices SET session_id = NULL
         WHERE session_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM sessions s WHERE s.id = technician_devices.session_id AND (s.expires_at < ?1 OR s.revoked_at < ?1)
         )`,
      )
      .bind(sessionsEnded),
    db.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(sessionsEnded),
    db.prepare("DELETE FROM sessions WHERE revoked_at < ?1").bind(sessionsEnded),
    // A hold nobody is paying for, past its grace, would otherwise stand until someone else held a window.
    ...lettingGo(db, now),
  ]);
}

/**
 * The AILabTools balance against its floor: an exhausted balance would otherwise fail every try-on quietly. Undefined
 * when the run has no outside call left for it; null when it could not be read.
 */
export async function checkAilabCredits(
  context: SweepContext,
  creditFloor: number,
): Promise<number | null | undefined> {
  const { deps, log, budget } = context;
  if (!budget.spend(1)) return undefined;
  const credits = await deps.image.credits();
  if (credits === null) {
    log.warn("credits_unreadable");
    return null;
  }
  if (credits >= creditFloor) {
    await deps.resolveAlert("ailab_credits_low");
    return credits;
  }
  // Told once, not every hour, until a top-up lifts the balance over the floor.
  await deps.alertOnce({
    key: "ailab_credits_low",
    message: `AILabTools credits are down to ${String(credits)}, below the floor of ${String(creditFloor)}.`,
  });
  return credits;
}

/**
 * Uploads nobody finished within an hour, and looks past their day, become `expired`. On its look's day a client's
 * try-on is kept (src/domain/kept-try-ons.ts); any other look goes, and its small copy with it.
 */
export async function expireTryOns(context: SweepContext): Promise<{ expired: number; kept: number }> {
  const { env, db, now, log } = sweepRun(context);
  const { results: pastExpiry } = await db
    .prepare(
      `SELECT id, created_at, person_id, photo_consent_version, state, result_key, expires_at, kept_at, copy_key,
         kept_look_key, number_proved_at
       FROM tryon_jobs WHERE state = 'ready' AND expires_at < ?1 ORDER BY created_at LIMIT ?2`,
    )
    .bind(now.toISOString(), EXPIRY_BATCH)
    .all<ExpiringTryOn>();
  const kept = await keepOrLetGo(env, pastExpiry, now);
  const results = pastExpiry.flatMap((row) => (row.result_key === null ? [] : [row.result_key]));
  if (results.length > 0) await env.RESULTS.delete(results);

  const abandonedBefore = new Date(now.getTime() - PHOTO_RETENTION_MS).toISOString();
  const [, expiredResults, abandonedUploads] = await db.batch([
    // The gate is claimed before the render (ADR 0104), so a visitor who leaves between the two leaves a message
    // waiting for a look never made. It is skipped with its job, in the same batch, before the job's state changes.
    db
      .prepare(
        `UPDATE outbound_messages SET state = 'skipped', last_error = 'no look was made'
         WHERE state = 'waiting' AND kind = 'tryon_result' AND subject_id IN (
           SELECT id FROM tryon_jobs WHERE state = 'awaiting_upload' AND created_at < ?1)`,
      )
      .bind(abandonedBefore),
    db
      .prepare(
        "UPDATE tryon_jobs SET state = 'expired' WHERE id IN (SELECT value FROM json_each(?1)) AND state = 'ready' RETURNING id",
      )
      .bind(JSON.stringify(pastExpiry.map((row) => row.id))),
    db
      .prepare(
        "UPDATE tryon_jobs SET state = 'expired' WHERE state = 'awaiting_upload' AND created_at < ?1 RETURNING id",
      )
      .bind(abandonedBefore),
  ]);
  const expired = (expiredResults?.results.length ?? 0) + (abandonedUploads?.results.length ?? 0);
  logCount(log, "tryons_expired", expired);
  logCount(log, "tryons_kept", kept);
  return { expired, kept };
}

/**
 * A photo is deleted an hour after its last job was created, once none of its
 * jobs is still running. The bucket's 30-day rule is only the backstop. Its
 * small copy goes with it, unless the try-on is kept, or is claimed and has its
 * look: then the copy is held as long as the look (docs/decisions/0084).
 */
export async function deletePhotos(context: SweepContext): Promise<number> {
  const { env, db, now, log } = sweepRun(context);
  const { results } = await db
    .prepare(
      `SELECT upload_key FROM tryon_jobs
       WHERE upload_deleted_at IS NULL AND uploaded_at IS NOT NULL
       GROUP BY upload_key
       HAVING MAX(created_at) < ?1 AND SUM(state IN ('queued', 'rendering', 'downloading')) = 0
       LIMIT ?2`,
    )
    .bind(new Date(now.getTime() - PHOTO_RETENTION_MS).toISOString(), BATCH_LIMIT)
    .all<{ upload_key: string }>();
  const keys = results.map((row) => row.upload_key);
  if (keys.length === 0) return 0;

  await env.UPLOADS.delete(keys);
  await db
    .prepare("UPDATE tryon_jobs SET upload_deleted_at = ?1 WHERE upload_key IN (SELECT value FROM json_each(?2))")
    .bind(now.toISOString(), JSON.stringify(keys))
    .run();
  await letCopiesGoWith(env, keys);
  logCount(log, "photos_deleted", keys.length);
  return keys.length;
}

/** A client's kept look, once their first fit is photographed (src/domain/kept-try-ons.ts). */
export async function letKeptLooksGo(context: SweepContext): Promise<number> {
  const { env, now, log } = sweepRun(context);
  const deleted = await letFittedLooksGo(env, now);
  logCount(log, "kept_looks_deleted", deleted);
  return deleted;
}

async function ids(statement: D1PreparedStatement): Promise<string[]> {
  const { results } = await statement.all<{ id: string }>();
  return results.map((row) => row.id);
}

/** The IDs each lookup found, the lookups run in one batch. */
async function idsOfEach(db: D1Database, statements: D1PreparedStatement[]): Promise<string[][]> {
  const answers = await db.batch<{ id: string }>(statements);
  return answers.map((answer) => answer.results.map((row) => row.id));
}

/** Puts the messages back on their queue. One the queue refuses is still waiting in D1, and the next run finds it. */
async function sendAll(queue: Queue, bodies: readonly unknown[], log: Logger): Promise<void> {
  const messages = bodies.map((body) => ({ body }));
  await enqueueBatch(queue, messages, { log, ifLost: "sweeper" });
}
