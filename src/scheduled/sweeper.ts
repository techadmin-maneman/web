// Runs every five minutes. D1 is the replay source: anything that should have
// moved on and has not is put back on its queue from here.
//
//   leads       pending over 2 minutes, or failed under 10 attempts   -> crm-sync
//   erasures    a person erased whose CRM record is not yet blanked     -> crm-sync
//   messages    queued but unsent for over 5 minutes                  -> messaging
//   renders     queued but never started, or rendering past the give-up time -> render
//   downloads   a stored result URL not yet fetched, until it expires  -> render
//   hourly      the AILabTools balance, against AILAB_CREDIT_FLOOR
//   expiry      abandoned uploads after an hour, results after 30 days, photos once their jobs are done

import { DOWNLOAD_QUEUE_RETRIES, RENDER_GIVE_UP_MS } from "../config/pipeline.ts";
import { PHOTO_RETENTION_MS } from "../config/tryon.ts";
import type { Dependencies } from "../dependencies.ts";
import { failJob } from "../domain/tryon.ts";
import { addDays, indiaDate } from "../lib/india-time.ts";
import type { Logger } from "../log.ts";
import { MAX_SYNC_ATTEMPTS, type CrmSyncMessage } from "../queues/crm-sync.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";
import { SENDING_LEASE_MS, type MessagingMessage } from "../queues/messaging.ts";
import type { RenderMessage } from "../queues/render.ts";

const MINUTE_MS = 60 * 1000;
/** A pending lead, or a queued job, older than this has lost its queue message. */
const PENDING_GRACE_MS = 2 * MINUTE_MS;
const MESSAGE_GRACE_MS = 5 * MINUTE_MS;
/** A submit that started this long ago and never recorded a task died part-way. */
const SUBMIT_ABANDONED_MS = 10 * MINUTE_MS;
/** Downloads are retried every sweep at first, then hourly until the URL expires. */
const DOWNLOAD_RETRY_EARLY_MS = 5 * MINUTE_MS;
const DOWNLOAD_RETRY_LATE_MS = 60 * MINUTE_MS;
const DOWNLOAD_EARLY_ATTEMPTS = DOWNLOAD_QUEUE_RETRIES + 3;
/** Most rows handled per kind per run; the next run takes the rest. */
const BATCH_LIMIT = 100;
const IDEMPOTENCY_TTL_MS = 24 * 60 * MINUTE_MS;
/** Rate-limit windows are at most a day; keep two more for inspection. */
const COUNTER_RETENTION_DAYS = 3;
/** A login code is kept a day past its expiry, for the logs to be read against; a session 30 days past its end. */
const CHALLENGE_RETENTION_MS = 24 * 60 * MINUTE_MS;
const SESSION_RETENTION_MS = 30 * 24 * 60 * MINUTE_MS;

export type SweepEnv = Pick<
  Env,
  "DB" | "CRM_QUEUE" | "RENDER_QUEUE" | "MESSAGE_QUEUE" | "UPLOADS" | "RESULTS" | "FSM_QUEUE"
>;

export interface SweepSummary {
  readonly leadsRequeued: number;
  readonly erasuresRequeued: number;
  readonly messagesRequeued: number;
  readonly rendersRequeued: number;
  readonly downloadsRequeued: number;
  readonly jobsExpired: number;
  readonly photosDeleted: number;
  /** The AILabTools balance, on the hourly run; undefined on the others. */
  readonly credits?: number | null;
}

export async function sweep(
  env: SweepEnv,
  deps: Dependencies,
  log: Logger,
  options: {
    readonly creditFloor: number;
    /** Whether FSM is connected, so an erased person's contact there can be anonymised. */
    readonly fsmErasure?: boolean;
  },
): Promise<SweepSummary> {
  const now = deps.now();
  const before = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const db = env.DB;

  // Leads that have not reached the CRM.
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

  // Erased people whose CRM record is still to be blanked.
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

  // Erased people whose FSM contact is still to be anonymised (docs/decisions/0049-dpdp.md).
  if (options.fsmErasure === true) {
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

  // Result messages that were queued and never sent.
  const messages = await ids(
    db
      .prepare(
        `SELECT id FROM outbound_messages
       WHERE state = 'queued' AND queued_at < ?1 AND (sending_at IS NULL OR sending_at < ?2)
       ORDER BY queued_at LIMIT ?3`,
      )
      .bind(before(MESSAGE_GRACE_MS), before(SENDING_LEASE_MS), BATCH_LIMIT),
  );
  await sendAll(
    env.MESSAGE_QUEUE,
    messages.map((id) => ({ message_id: id, request_id: "sweeper" }) satisfies MessagingMessage),
  );

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

  const jobsExpired = await expireJobs(env, now);
  const photosDeleted = await deletePhotos(env, now);

  await db.batch([
    db.prepare("DELETE FROM idempotency WHERE created_at < ?1").bind(before(IDEMPOTENCY_TTL_MS)),
    db.prepare("DELETE FROM counters WHERE window_start < ?1").bind(addDays(indiaDate(now), -COUNTER_RETENTION_DAYS)),
    db.prepare("DELETE FROM tryon_sessions WHERE expires_at < ?1").bind(now.toISOString()),
    db.prepare("DELETE FROM otp_challenges WHERE expires_at < ?1").bind(before(CHALLENGE_RETENTION_MS)),
    db.prepare("DELETE FROM sessions WHERE expires_at < ?1 OR revoked_at < ?1").bind(before(SESSION_RETENTION_MS)),
  ]);

  // Once an hour: an exhausted balance would otherwise fail every try-on quietly.
  let credits: number | null | undefined;
  if (now.getUTCMinutes() < 5) {
    credits = await deps.image.credits();
    if (credits === null) log.warn("credits_unreadable");
    else if (credits < options.creditFloor) {
      await deps.alert(
        `AILabTools credits are down to ${String(credits)}, below the floor of ${String(options.creditFloor)}.`,
      );
    }
  }

  const summary: SweepSummary = {
    leadsRequeued: leads.length,
    erasuresRequeued: erasures.length,
    messagesRequeued: messages.length,
    rendersRequeued: renders.length,
    downloadsRequeued: downloads.length,
    jobsExpired,
    photosDeleted,
    ...(credits === undefined ? {} : { credits }),
  };
  log.info("sweep", {
    leads_requeued: summary.leadsRequeued,
    erasures_requeued: summary.erasuresRequeued,
    messages_requeued: summary.messagesRequeued,
    renders_requeued: summary.rendersRequeued,
    downloads_requeued: summary.downloadsRequeued,
    submits_abandoned: abandoned.length,
    results_lost: lost.length,
    jobs_expired: jobsExpired,
    photos_deleted: photosDeleted,
    credits: credits ?? null,
  });
  return summary;
}

/** Uploads nobody finished within an hour, and results past their 30 days, become `expired`. */
async function expireJobs(env: SweepEnv, now: Date): Promise<number> {
  const db = env.DB;
  const pastExpiry = await db
    .prepare("SELECT id, result_key FROM tryon_jobs WHERE state = 'ready' AND expires_at < ?1 LIMIT ?2")
    .bind(now.toISOString(), BATCH_LIMIT)
    .all<{ id: string; result_key: string | null }>();
  const keys = pastExpiry.results.flatMap((row) => (row.result_key === null ? [] : [row.result_key]));
  if (keys.length > 0) await env.RESULTS.delete(keys);

  const [expiredResults, abandonedUploads] = await db.batch([
    db
      .prepare(
        "UPDATE tryon_jobs SET state = 'expired' WHERE id IN (SELECT value FROM json_each(?1)) AND state = 'ready' RETURNING id",
      )
      .bind(JSON.stringify(pastExpiry.results.map((row) => row.id))),
    db
      .prepare(
        "UPDATE tryon_jobs SET state = 'expired' WHERE state = 'awaiting_upload' AND created_at < ?1 RETURNING id",
      )
      .bind(new Date(now.getTime() - PHOTO_RETENTION_MS).toISOString()),
  ]);
  return (expiredResults?.results.length ?? 0) + (abandonedUploads?.results.length ?? 0);
}

/**
 * A photo is deleted an hour after its last job was created, once none of its
 * jobs is still running. The bucket's 30-day rule is only the backstop.
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
  return keys.length;
}

async function ids(statement: D1PreparedStatement): Promise<string[]> {
  const { results } = await statement.all<{ id: string }>();
  return results.map((row) => row.id);
}

async function sendAll(queue: Queue, bodies: readonly unknown[]): Promise<void> {
  if (bodies.length > 0) await queue.sendBatch(bodies.map((body) => ({ body })));
}
