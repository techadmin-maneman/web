// Runs every five minutes. D1 is the replay source: anything that should have
// moved on and has not is put back on its queue from here.
//
//   leads       pending over 2 minutes, or failed under 10 attempts   -> crm-sync
//   bookings    a booked lead never put on its queue, after 2 minutes  -> fsm-sync
//   erasures    a person erased whose CRM record is not yet blanked     -> crm-sync
//               or whose FSM contact is not yet anonymised              -> fsm-sync
//   job steps   a technician's step not written to FSM for 15 minutes -> fsm-sync
//               and after an hour, an alert naming it
//   messages    queued but unsent for over 5 minutes, while WhatsApp is up -> messaging
//               and failed after a day (src/scheduled/unsent-messages.ts)
//   renders     queued but never started, or rendering past the give-up time -> render
//   downloads   a stored result URL not yet fetched, until it expires  -> render
//   moves       a dispatch move still open after five minutes: its claimed time let go, the move closed
//   hourly      the AILabTools balance, against AILAB_CREDIT_FLOOR
//   expiry      abandoned uploads after an hour, results once RESULT_RETENTION_DAYS is up (14 in production,
//               3 on staging), photos once their jobs are done; a client's try-on is kept on its look's day, and
//               any other photo's small copy goes with the photo or the look (docs/decisions/0084)
//   kept looks  a client's kept look once their first fit is photographed
//   cleanup     idempotency keys after a day, login codes a day past expiry, rate counters after 3 days,
//               try-on sessions once expired, and app sessions 30 days after they ended

import { DOWNLOAD_QUEUE_RETRIES, RENDER_GIVE_UP_MS } from "../config/pipeline.ts";
import { PHOTO_RETENTION_MS } from "../config/tryon.ts";
import type { Dependencies } from "../dependencies.ts";
import { unfinishedMovesLetGo } from "../domain/dispatch.ts";
import { keepOrLetGo, letCopiesGoWith, letFittedLooksGo, type ExpiringTryOn } from "../domain/kept-try-ons.ts";
import { failJob } from "../domain/tryon.ts";
import type { CallBudget } from "../lib/call-budget.ts";
import { addDays, indiaDate } from "../lib/india-time.ts";
import type { Logger } from "../log.ts";
import { MAX_SYNC_ATTEMPTS, type CrmSyncMessage } from "../queues/crm-sync.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";
import type { RenderMessage } from "../queues/render.ts";
import { requeueUnsentMessages } from "./unsent-messages.ts";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "../lib/durations.ts";

/** A pending lead, or a queued job, older than this has lost its queue message. */
const PENDING_GRACE_MS = 2 * MINUTE_MS;
/** Past the fsm-sync consumer's whole retry chain: 30 s, 1, 2 and 4 minutes. */
const JOB_EVENT_GRACE_MS = 15 * MINUTE_MS;
/** A step still not in FSM after this has outlived several sends, and ops are told. */
const JOB_EVENT_ALERT_AFTER_MS = 60 * MINUTE_MS;
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
 * about 320, and the next run, five minutes on, takes the rest.
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
  "DB" | "CRM_QUEUE" | "RENDER_QUEUE" | "MESSAGE_QUEUE" | "UPLOADS" | "RESULTS" | "CLIENT_PHOTOS" | "FSM_QUEUE"
>;

export interface SweepSummary {
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
  /** The AILabTools balance, on the hourly run; undefined on the others. */
  readonly credits?: number | null;
}

/** One sweep's run: where it writes, what it calls, and the moment it counts from. */
interface SweepRun {
  readonly env: SweepEnv;
  readonly db: D1Database;
  readonly deps: Dependencies;
  readonly log: Logger;
  readonly now: Date;
  /** The instant `ms` before now, as ISO. */
  readonly before: (ms: number) => string;
}

export async function sweep(
  env: SweepEnv,
  deps: Dependencies,
  log: Logger,
  options: {
    readonly creditFloor: number;
    /** Whether FSM is connected, so bookings are sent there and an erased person's contact is anonymised. */
    readonly fsmConnected?: boolean;
    /** The cron run's outside calls; the hourly balance check takes one. */
    readonly budget: CallBudget;
  },
): Promise<SweepSummary> {
  const now = deps.now();
  const run: SweepRun = {
    env,
    db: env.DB,
    deps,
    log,
    now,
    before: (ms: number) => new Date(now.getTime() - ms).toISOString(),
  };

  const leads = await requeueLeads(run);
  const erasures = await requeueCrmErasures(run);
  if (options.fsmConnected === true) await requeueFsmErasures(run);
  const jobEvents = await requeueJobEvents(run);
  const messages = await requeueUnsentMessages({
    db: env.DB,
    queue: env.MESSAGE_QUEUE,
    deps,
    log,
    now,
    budget: options.budget,
  });
  const { renders, abandoned, downloads, lost } = await requeueTryons(run);
  const { expired: jobsExpired, kept: tryOnsKept } = await expireJobs(env, now);
  const photosDeleted = await deletePhotos(env, now);
  const keptLooksDeleted = await letFittedLooksGo(env, now);
  await housekeep(run);
  const credits = await checkCredits(run, options);

  const summary: SweepSummary = {
    leadsRequeued: leads.length,
    erasuresRequeued: erasures.length,
    messagesRequeued: messages.length,
    rendersRequeued: renders.length,
    downloadsRequeued: downloads.length,
    jobsExpired,
    photosDeleted,
    tryOnsKept,
    keptLooksDeleted,
    ...(credits === undefined ? {} : { credits }),
  };
  log.info("sweep", {
    leads_requeued: summary.leadsRequeued,
    erasures_requeued: summary.erasuresRequeued,
    job_events_requeued: jobEvents.length,
    messages_requeued: summary.messagesRequeued,
    renders_requeued: summary.rendersRequeued,
    downloads_requeued: summary.downloadsRequeued,
    submits_abandoned: abandoned.length,
    results_lost: lost.length,
    jobs_expired: jobsExpired,
    photos_deleted: photosDeleted,
    try_ons_kept: tryOnsKept,
    kept_looks_deleted: keptLooksDeleted,
    credits: credits ?? null,
  });
  return summary;
}

/** Leads that have not reached the CRM, sent to crm-sync again. */
async function requeueLeads(run: SweepRun): Promise<string[]> {
  const { db, env, before } = run;
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
  );
  return leads;
}

/** Erased people whose CRM record is still to be blanked, sent to crm-sync again. */
async function requeueCrmErasures(run: SweepRun): Promise<string[]> {
  const { db, env, before } = run;
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
  );
  return erasures;
}

/** Erased people whose FSM contact is still to be anonymised, sent to fsm-sync: only where FSM is connected. */
async function requeueFsmErasures(run: SweepRun): Promise<void> {
  const { db, env, before } = run;
  // docs/decisions/0049-dpdp.md
  const fsmErasures = await ids(
    db
      .prepare(
        `SELECT id FROM people
       WHERE erased_at < ?1 AND fsm_contact_id IS NOT NULL AND fsm_erased_at IS NULL AND fsm_erasure_attempts < ?2
       ORDER BY erased_at LIMIT ?3`,
      )
      .bind(before(PENDING_GRACE_MS), MAX_SYNC_ATTEMPTS, BATCH_LIMIT),
  );
  await sendAll(
    env.FSM_QUEUE,
    fsmErasures.map((id) => ({ erase_person_id: id, request_id: "sweeper" }) satisfies FsmSyncMessage),
  );
}

/** A technician's steps not written to FSM, sent to fsm-sync again, and ops told of one stuck an hour. */
async function requeueJobEvents(run: SweepRun): Promise<string[]> {
  const { db, env, now, before, deps } = run;
  // A technician's steps whose queue message was lost, or never sent. Only a job's earliest step
  // waiting for FSM: the consumer sends each next one on once the one before it is written. Each is
  // stamped as it is sent, so it is not sent again while its retries may still be running.
  const jobEvents = await ids(
    db
      .prepare(
        `UPDATE job_events SET updated_at = ?1
         WHERE id IN (
           SELECT e.id FROM job_events e
           WHERE e.fsm_write_state = 'pending' AND e.superseded = 0 AND e.updated_at < ?2
             AND NOT EXISTS (
               SELECT 1 FROM job_events b
               WHERE b.appointment_id = e.appointment_id AND b.fsm_write_state = 'pending' AND b.superseded = 0
                 AND (b.received_at, b.rowid) < (e.received_at, e.rowid))
           ORDER BY e.received_at LIMIT ?3)
         RETURNING id`,
      )
      .bind(now.toISOString(), before(JOB_EVENT_GRACE_MS), BATCH_LIMIT),
  );
  await sendAll(
    env.FSM_QUEUE,
    jobEvents.map((id) => ({ job_event_id: id, request_id: "sweeper" }) satisfies FsmSyncMessage),
  );
  await alertStuckJobEvents(db, deps, before(JOB_EVENT_ALERT_AFTER_MS));
  return jobEvents;
}

/** Try-on renders and downloads whose queue message was lost, sent to render again; ones past saving failed. */
async function requeueTryons(
  run: SweepRun,
): Promise<{ renders: string[]; abandoned: string[]; downloads: string[]; lost: string[] }> {
  const { db, env, now, before, deps } = run;
  // Renders whose queue message was lost: never started, or silent past the give-up time.
  const renders = await ids(
    db
      .prepare(
        `SELECT id FROM tryon_jobs
       WHERE (state = 'queued' AND submit_started_at IS NULL AND created_at < ?1)
          OR (state = 'rendering' AND submitted_at < ?2)
       ORDER BY created_at LIMIT ?3`,
      )
      .bind(before(PENDING_GRACE_MS), before(RENDER_GIVE_UP_MS + PENDING_GRACE_MS), BATCH_LIMIT),
  );

  // A submit that started and never finished cannot be resumed: we do not know whether AILabTools took it.
  const abandoned = await ids(
    db
      .prepare(
        "SELECT id FROM tryon_jobs WHERE state = 'queued' AND submit_started_at < ?1 AND provider_task_id IS NULL LIMIT ?2",
      )
      .bind(before(SUBMIT_ABANDONED_MS), BATCH_LIMIT),
  );
  for (const id of abandoned) await failJob(db, id, "render_failed", "submit did not finish", now);

  // Paid results not yet downloaded: retried until their URL expires, then lost.
  const downloads = await ids(
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
  );
  const lost = await ids(
    db
      .prepare("SELECT id FROM tryon_jobs WHERE state = 'downloading' AND provider_result_expires_at <= ?1 LIMIT ?2")
      .bind(now.toISOString(), BATCH_LIMIT),
  );
  for (const id of lost) {
    if (await failJob(db, id, "render_failed", "result URL expired before download", now)) {
      await deps.alert(`Try-on job ${id}: its result was billed but never downloaded, and its URL has expired.`);
    }
  }
  await sendAll(
    env.RENDER_QUEUE,
    [...renders, ...downloads].map((id) => ({ job_id: id, request_id: "sweeper" }) satisfies RenderMessage),
  );
  return { renders, abandoned, downloads, lost };
}

/** Deletes what has outlived its use: idempotency keys, counters, sessions, spent codes and stale claims. */
async function housekeep(run: SweepRun): Promise<void> {
  const { db, now, before } = run;
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
    // A client's hold can take a technician's time again once a move that never finished lets it go.
    ...unfinishedMovesLetGo(db, now),
  ]);
}

/** Once an hour, the AILabTools balance against its floor; undefined on the other runs. */
async function checkCredits(
  run: SweepRun,
  options: { readonly creditFloor: number; readonly budget: CallBudget },
): Promise<number | null | undefined> {
  const { now, deps, log } = run;
  // Once an hour: an exhausted balance would otherwise fail every try-on quietly.
  let credits: number | null | undefined;
  if (now.getUTCMinutes() < 5 && options.budget.spend(1)) {
    credits = await deps.image.credits();
    if (credits === null) log.warn("credits_unreadable");
    else if (credits < options.creditFloor) {
      // Told once, not every hour, until a top-up lifts the balance over the floor.
      await deps.alertOnce({
        key: "ailab_credits_low",
        message: `AILabTools credits are down to ${String(credits)}, below the floor of ${String(options.creditFloor)}.`,
      });
    } else {
      await deps.resolveAlert("ailab_credits_low");
    }
  }
  return credits;
}

/**
 * A job's earliest step still waiting for FSM an hour after it landed, told to
 * ops once each, with IDs only. The steps behind it wait for it, so it is the
 * one to name. The alert closes when the step is written (src/queues/fsm-sync.ts).
 */
async function alertStuckJobEvents(db: D1Database, deps: Dependencies, landedBefore: string): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT e.id, e.kind, e.appointment_id, a.person_id FROM job_events e
       JOIN appointments a ON a.id = e.appointment_id
       WHERE e.fsm_write_state = 'pending' AND e.superseded = 0 AND e.received_at < ?1
         AND NOT EXISTS (
           SELECT 1 FROM job_events b
           WHERE b.appointment_id = e.appointment_id AND b.fsm_write_state = 'pending' AND b.superseded = 0
             AND (b.received_at, b.rowid) < (e.received_at, e.rowid))
       ORDER BY e.received_at LIMIT ?2`,
    )
    .bind(landedBefore, BATCH_LIMIT)
    .all<{ id: string; kind: string; appointment_id: string; person_id: string | null }>();
  for (const step of results) {
    await deps.alertOnce({
      key: `job_event_pending:${step.id}`,
      message:
        `A technician's ${step.kind} (job event ${step.id}) on visit ${step.appointment_id} has waited over an hour ` +
        "to reach FSM. The sweeper keeps sending it; if it has not landed soon, enter it in FSM by hand.",
      link: step.person_id === null ? "/dispatch" : `/clients/${step.person_id}`,
    });
  }
}

/**
 * Uploads nobody finished within an hour, and looks past their day, become `expired`. On its look's day a client's
 * try-on is kept (src/domain/kept-try-ons.ts); any other look goes, and its small copy with it.
 */
async function expireJobs(env: SweepEnv, now: Date): Promise<{ expired: number; kept: number }> {
  const db = env.DB;
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
  return {
    expired: (expiredResults?.results.length ?? 0) + (abandonedUploads?.results.length ?? 0),
    kept,
  };
}

/**
 * A photo is deleted an hour after its last job was created, once none of its
 * jobs is still running. The bucket's 30-day rule is only the backstop. Its
 * small copy goes with it, unless the try-on is kept, or is claimed and has its
 * look: then the copy is held as long as the look (docs/decisions/0084).
 */
async function deletePhotos(env: SweepEnv, now: Date): Promise<number> {
  const db = env.DB;
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
  return keys.length;
}

async function ids(statement: D1PreparedStatement): Promise<string[]> {
  const { results } = await statement.all<{ id: string }>();
  return results.map((row) => row.id);
}

async function sendAll(queue: Queue, bodies: readonly unknown[]): Promise<void> {
  if (bodies.length > 0) await queue.sendBatch(bodies.map((body) => ({ body })));
}
