// The render consumer: the only caller of AILabTools. Each delivery moves a
// job one step and, if the job is still running, asks the queue to deliver it
// again later. Nothing waits inside the Worker for a render to finish.
//
//   queued       read the photo, submit it              -> rendering
//   rendering    poll once; not done: retry in 5-60 s   -> downloading
//   downloading  keep the result URL, then download it  -> ready
//
// The API bills on generation, not delivery (API notes, 7.10). So a job is
// submitted at most once, and a result that fails to download is retried from
// its stored URL, never rendered again. See docs/decisions/0015-render-pipeline.md.

import { z } from "zod";
import {
  DOWNLOAD_QUEUE_RETRIES,
  POLL_DELAY_SECONDS,
  POLL_SLOWDOWN_AFTER_MS,
  POLL_SLOW_AFTER_MS,
  RENDER_GIVE_UP_MS,
  RESULT_URL_LIFETIME_MS,
  SUBMIT_ATTEMPTS,
} from "../config/pipeline.ts";
import { findPreset } from "../config/presets.ts";
import type { Dependencies } from "../dependencies.ts";
import { checkPhoto } from "../domain/photo.ts";
import { failJob, loadJob, type JobRow } from "../domain/tryon.ts";
import { fileExtension } from "../lib/image-bytes.ts";
import type { Logger } from "../log.ts";
import type { RenderFailure } from "../providers/image/index.ts";
import { enqueue } from "../domain/enqueue.ts";
import { DAY_MS, MINUTE_MS } from "../lib/durations.ts";
import { type MessagingMessage } from "../config/pipeline.ts";
import { DONE, runConsumer, type Settle } from "./consumer.ts";

export const RenderMessageSchema = z.object({ job_id: z.uuid(), request_id: z.string() });
export type RenderMessage = z.infer<typeof RenderMessageSchema>;

const SUBMIT_RETRY_DELAY_SECONDS = 10;
const DOWNLOAD_RETRY_DELAY_SECONDS = 60;

export type RenderEnv = Pick<Env, "DB" | "UPLOADS" | "RESULTS" | "MESSAGE_QUEUE">;

interface RenderOptions {
  /** Days a result is kept once ready (RESULT_RETENTION_DAYS). */
  readonly resultRetentionDays: number;
}

type Next = Settle;

/** Each job's next step; one that D1 or R2 fails is tried again shortly. */
export function handleRenderBatch(
  batch: MessageBatch,
  env: RenderEnv,
  deps: Dependencies,
  log: Logger,
  options: RenderOptions,
): Promise<void> {
  return runConsumer(batch, {
    name: "render",
    schema: RenderMessageSchema,
    log,
    logFor: (data) => log.child({ request_id: data.request_id, job_id: data.job_id }),
    handle: (data, _attempts, jobLog) => advanceJob(env, deps, jobLog, data.job_id, options),
  });
}

export async function advanceJob(
  env: RenderEnv,
  deps: Dependencies,
  log: Logger,
  jobId: string,
  options: RenderOptions,
): Promise<Next> {
  const job = await loadJob(env.DB, jobId);
  if (job === null) {
    log.error("render_unknown_job");
    return DONE;
  }
  switch (job.state) {
    case "queued":
      return submit(env, deps, log, job);
    case "rendering":
      return poll(env, deps, log, job, options);
    case "downloading":
      return download(env, deps, log, job, options);
    case "awaiting_upload":
    case "ready":
    case "failed":
    case "expired":
      return DONE; // never generated, or finished already: a stale message
  }
}

async function submit(env: RenderEnv, deps: Dependencies, log: Logger, job: JobRow): Promise<Next> {
  const db = env.DB;
  const now = deps.now();

  // Claim the submit, so a second delivery of this message cannot submit (and pay) again.
  const claim = await db
    .prepare(
      `UPDATE tryon_jobs SET submit_started_at = ?2, submit_attempts = submit_attempts + 1
       WHERE id = ?1 AND state = 'queued' AND submit_started_at IS NULL
       RETURNING submit_attempts`,
    )
    .bind(job.id, now.toISOString())
    .first<{ submit_attempts: number }>();
  if (claim === null) return DONE;

  const preset = findPreset(job.preset ?? "");
  if (preset === undefined || job.endpoint === null || job.provider_color === null) {
    return fail(env, deps, log, job, {
      code: "render_failed",
      transient: false,
      alert: true,
      detail: "job has no render choice",
    });
  }

  const upload = await env.UPLOADS.get(job.upload_key);
  if (upload === null) {
    return fail(env, deps, log, job, {
      code: "render_failed",
      transient: false,
      alert: false,
      detail: "photo no longer stored",
    });
  }
  // The upload route checked the photo; this guards against anything that slipped past.
  const image = new Uint8Array(await upload.arrayBuffer());
  const photo = checkPhoto(image);
  if (!photo.ok) {
    return fail(env, deps, log, job, {
      code: "photo_invalid_file",
      transient: false,
      alert: false,
      detail: photo.problem,
    });
  }

  const result = await deps.image.submit(image, preset, job.provider_color, job.endpoint);
  if (result.ok) {
    await db
      .prepare(
        `UPDATE tryon_jobs SET state = 'rendering', provider_task_id = ?2, submitted_at = ?3
         WHERE id = ?1 AND state = 'queued'`,
      )
      .bind(job.id, result.taskId, deps.now().toISOString())
      .run();
    log.info("render_submitted", { endpoint: job.endpoint, attempt: claim.submit_attempts });
    return { retryAfterSeconds: POLL_DELAY_SECONDS.early };
  }

  if (result.failure.transient && claim.submit_attempts < SUBMIT_ATTEMPTS) {
    // Failed calls bill nothing (API notes, 7.6), so a network error or a 5xx is worth another go.
    await db.prepare("UPDATE tryon_jobs SET submit_started_at = NULL WHERE id = ?1").bind(job.id).run();
    log.warn("render_submit_retry", { attempt: claim.submit_attempts, detail: result.failure.detail });
    return { retryAfterSeconds: SUBMIT_RETRY_DELAY_SECONDS };
  }
  return fail(env, deps, log, job, result.failure);
}

async function poll(
  env: RenderEnv,
  deps: Dependencies,
  log: Logger,
  job: JobRow,
  options: RenderOptions,
): Promise<Next> {
  if (job.provider_task_id === null || job.endpoint === null) {
    return fail(env, deps, log, job, {
      code: "render_failed",
      transient: false,
      alert: true,
      detail: "rendering without a task",
    });
  }
  const elapsed = deps.now().getTime() - Date.parse(job.submitted_at ?? job.created_at);
  const result = await deps.image.poll(job.provider_task_id, job.endpoint);

  if (result.state === "done") {
    const now = deps.now();
    // Keep the URL before downloading: if the download fails, it is the only way back to a paid image.
    const expiresAt = new Date(now.getTime() + RESULT_URL_LIFETIME_MS).toISOString();
    await env.DB.prepare(
      `UPDATE tryon_jobs SET state = 'downloading', provider_result_url = ?2, provider_result_expires_at = ?3
       WHERE id = ?1 AND state = 'rendering'`,
    )
      .bind(job.id, result.resultUrl, expiresAt)
      .run();
    return download(
      env,
      deps,
      log,
      {
        ...job,
        state: "downloading",
        provider_result_url: result.resultUrl,
        provider_result_expires_at: expiresAt,
      },
      options,
    );
  }

  const withinDeadline = elapsed <= RENDER_GIVE_UP_MS;
  if (result.state === "failed" && !(result.failure.transient && withinDeadline)) {
    return fail(env, deps, log, job, result.failure);
  }
  if (!withinDeadline) {
    // Probably billed already: Premium bills while it renders. The task can still be polled by hand.
    const detail = `no result ${String(Math.round(elapsed / MINUTE_MS))} min after submitting; task ${job.provider_task_id}`;
    return fail(env, deps, log, job, { code: "render_failed", transient: false, alert: true, detail });
  }
  return { retryAfterSeconds: pollDelay(elapsed) };
}

/** 5 s at first, 10 s after 30 s, once a minute after 3 minutes. */
function pollDelay(elapsed: number): number {
  if (elapsed < POLL_SLOWDOWN_AFTER_MS) return POLL_DELAY_SECONDS.early;
  if (elapsed < POLL_SLOW_AFTER_MS) return POLL_DELAY_SECONDS.late;
  return POLL_DELAY_SECONDS.slow;
}

async function download(
  env: RenderEnv,
  deps: Dependencies,
  log: Logger,
  job: JobRow,
  options: RenderOptions,
): Promise<Next> {
  const db = env.DB;
  const now = deps.now();
  const url = job.provider_result_url;
  const expiresAt = Date.parse(job.provider_result_expires_at ?? "");
  if (url === null || !(expiresAt > now.getTime())) {
    return fail(env, deps, log, job, {
      code: "render_failed",
      transient: false,
      alert: true,
      detail: "result URL expired before the image was downloaded: a billed image is lost",
    });
  }

  const attempt = await db
    .prepare(
      `UPDATE tryon_jobs SET download_attempts = download_attempts + 1, download_attempted_at = ?2
       WHERE id = ?1 RETURNING download_attempts`,
    )
    .bind(job.id, now.toISOString())
    .first<{ download_attempts: number }>();
  const attempts = attempt?.download_attempts ?? 1;

  const result = await deps.image.download(url);
  if (!result.ok && !result.transient) {
    // Billed, and never usable: downloading it again would only fetch the same bytes.
    return fail(env, deps, log, job, { code: "render_failed", transient: false, alert: true, detail: result.detail });
  }
  if (!result.ok) {
    log.warn("render_download_failed", { attempts, detail: result.detail });
    // The queue tries again soon; after that the sweeper keeps trying until the URL expires.
    return attempts < DOWNLOAD_QUEUE_RETRIES ? { retryAfterSeconds: DOWNLOAD_RETRY_DELAY_SECONDS } : DONE;
  }

  const resultKey = `results/${job.id}.${fileExtension(result.contentType)}`;
  await env.RESULTS.put(resultKey, result.bytes, { httpMetadata: { contentType: result.contentType } });

  const readyAt = deps.now();
  const latencyMs = readyAt.getTime() - Date.parse(job.submitted_at ?? job.created_at);
  const [stored, queued] = await db.batch([
    db
      .prepare(
        `UPDATE tryon_jobs SET state = 'ready', result_key = ?2, expires_at = ?3, latency_ms = ?4
         WHERE id = ?1 AND state = 'downloading'`,
      )
      .bind(
        job.id,
        resultKey,
        new Date(readyAt.getTime() + options.resultRetentionDays * DAY_MS).toISOString(),
        latencyMs,
      ),
    // A gate submitted before the result was ready left its message waiting for this.
    db
      .prepare(
        `UPDATE outbound_messages SET state = 'queued', queued_at = ?2
         WHERE subject_id = ?1 AND state = 'waiting' RETURNING id`,
      )
      .bind(job.id, readyAt.toISOString()),
  ]);
  if (stored?.meta.changes === 0) {
    // The job moved on while this ran: the person was erased, or a parallel run stored the result first.
    const current = await db
      .prepare("SELECT result_key FROM tryon_jobs WHERE id = ?1")
      .bind(job.id)
      .first<{ result_key: string | null }>();
    if (current?.result_key !== resultKey) await env.RESULTS.delete(resultKey);
    log.info("render_result_discarded", { attempts });
    return DONE;
  }
  log.info("render_ready", { endpoint: job.endpoint, latency_ms: latencyMs, bytes: result.bytes.byteLength, attempts });

  for (const row of (queued?.results ?? []) as { id: string }[]) {
    const body = { message_id: row.id, request_id: job.request_id } satisfies MessagingMessage;
    await enqueue(env.MESSAGE_QUEUE, body, { log, ifLost: "sweeper" });
  }
  return DONE;
}

async function fail(
  env: RenderEnv,
  deps: Dependencies,
  log: Logger,
  job: JobRow,
  failure: RenderFailure,
): Promise<Next> {
  const changed = await failJob(env.DB, job.id, failure.code, failure.detail, deps.now());
  if (changed) {
    log.warn("render_failed", { code: failure.code, detail: failure.detail, endpoint: job.endpoint });
    if (failure.alert) await deps.alert(`Try-on job ${job.id} failed (${failure.code}): ${failure.detail}`);
  }
  return DONE;
}
