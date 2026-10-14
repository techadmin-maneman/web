// The render consumer: the only caller of YouCam. Each delivery moves a job one step and, if the job is still
// running, asks the queue to deliver it again later. Nothing waits inside the Worker for a render to finish.
//
//   queued       read the photo; the same photograph in the same look made before? copy its image -> ready
//                otherwise submit it with the look's reference                                -> rendering
//   rendering    poll once; not done: retry in 2-5 s                                          -> downloading
//   downloading  keep the result URL, then download it                                       -> ready
//
// YouCam bills a render it makes, never one it refuses. So a job is submitted once, made once more only when YouCam's
// own model fails or runs out of time (RENDER_ATTEMPTS), and a result that fails to download is retried from its
// stored URL, never rendered again. See docs/decisions/0015-render-pipeline.md and 0201-the-try-on-on-youcam.md.

import { z } from "zod";
import {
  DOWNLOAD_QUEUE_RETRIES,
  POLL_DELAY_SECONDS,
  POLL_SLOWDOWN_AFTER_MS,
  RENDER_ATTEMPTS,
  RENDER_GIVE_UP_MS,
  RESULT_URL_LIFETIME_MS,
  SUBMIT_ATTEMPTS,
} from "../config/pipeline.ts";
import { findPreset, referenceUrlOf, REFERENCE_VERSION, type Preset } from "../config/presets.ts";
import type { Dependencies } from "../dependencies.ts";
import { checkPhoto } from "../domain/try-on/photo.ts";
import { failJob, loadJob, type JobRow } from "../domain/try-on/tryon.ts";
import { fileExtension, inspectImage } from "../lib/image-bytes.ts";
import type { Logger } from "../log.ts";
import type { DownloadResult, RenderFailure } from "../providers/image/index.ts";
import { enqueue } from "../domain/platform/enqueue.ts";
import { DAY_MS, MINUTE_MS } from "../lib/durations.ts";
import { TRYON_PAUSED_KEYS } from "../policy/alerts.ts";
import { type MessagingMessage } from "../config/pipeline.ts";
import { DONE, runConsumer, type Settle } from "./consumer.ts";

const RenderMessageSchema = z.object({ job_id: z.uuid(), request_id: z.string() });
export type RenderMessage = z.infer<typeof RenderMessageSchema>;

const SUBMIT_RETRY_DELAY_SECONDS = 10;

const DOWNLOAD_RETRY_DELAY_SECONDS = 60;

export type RenderEnv = Pick<Env, "DB" | "UPLOADS" | "RESULTS" | "MESSAGE_QUEUE">;

interface RenderOptions {
  /** Days a result is kept once ready (RESULT_RETENTION_DAYS). */
  readonly resultRetentionDays: number;
  /** Where YouCam fetches the looks' reference photographs (TRYON_REFS_URL). */
  readonly refsUrl: string;
}

type Next = Settle;

/** Each job's next step; one that D1 or R2 fails is tried again shortly. */
export function handleRenderBatch({
  batch,
  env,
  deps,
  log,
  options,
}: {
  batch: MessageBatch;
  env: RenderEnv;
  deps: Dependencies;
  log: Logger;
  options: RenderOptions;
}): Promise<void> {
  return runConsumer(batch, {
    name: "render",
    schema: RenderMessageSchema,
    log,
    logFor: (data) => log.child({ request_id: data.request_id, job_id: data.job_id }),
    handle: (data, _attempts, jobLog) => advanceJob({ env, deps, log: jobLog, jobId: data.job_id, options }),
  });
}

export async function advanceJob({
  env,
  deps,
  log,
  jobId,
  options,
}: {
  env: RenderEnv;
  deps: Dependencies;
  log: Logger;
  jobId: string;
  options: RenderOptions;
}): Promise<Next> {
  const job = await loadJob(env.DB, jobId);
  if (job === null) {
    log.error("render_unknown_job");
    return DONE;
  }
  const step = { env, deps, log, job, options };
  switch (job.state) {
    case "queued":
      return submit(step);
    case "rendering":
      return poll(step);
    case "downloading":
      return download(step);
    case "awaiting_upload":
    case "ready":
    case "failed":
    case "expired":
      return DONE; // never generated, or finished already: a stale message
  }
}

interface Step {
  readonly env: RenderEnv;
  readonly deps: Dependencies;
  readonly log: Logger;
  readonly job: JobRow;
  readonly options: RenderOptions;
}

/** The render a look is: the photograph's own bytes, the look, the references' version, and who makes it. */
async function renderKeyOf(image: Uint8Array, preset: Preset): Promise<string> {
  const hex = (bytes: ArrayBuffer) =>
    [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const photo = hex(await crypto.subtle.digest("SHA-256", image));
  const key = new TextEncoder().encode([photo, preset.id, REFERENCE_VERSION, "youcam"].join(":"));
  return hex(await crypto.subtle.digest("SHA-256", key));
}

async function submit(step: Step): Promise<Next> {
  const { env, deps, log, job, options } = step;
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
  if (preset === undefined) {
    return fail(step, { code: "render_failed", transient: false, alert: true, detail: "job has no look" });
  }

  const upload = await env.UPLOADS.get(job.upload_key);
  if (upload === null) {
    return fail(step, { code: "render_failed", transient: false, alert: false, detail: "photo no longer stored" });
  }
  // The upload route checked the photo; this guards against anything that slipped past.
  const image = new Uint8Array(await upload.arrayBuffer());
  const photo = checkPhoto(image);
  if (!photo.ok) {
    return fail(step, { code: "photo_invalid_file", transient: false, alert: false, detail: photo.problem });
  }

  const renderKey = await renderKeyOf(image, preset);
  await db.prepare("UPDATE tryon_jobs SET render_key = ?2 WHERE id = ?1").bind(job.id, renderKey).run();
  const made = await copyOfMadeBefore(step, renderKey);
  if (made !== null) return made;

  const result = await deps.image.submit(image, referenceUrlOf(options.refsUrl, preset));
  if (result.ok) {
    await db
      .prepare(
        `UPDATE tryon_jobs SET state = 'rendering', provider_task_id = ?2, submitted_at = ?3, renders = renders + 1
         WHERE id = ?1 AND state = 'queued'`,
      )
      .bind(job.id, result.taskId, deps.now().toISOString())
      .run();
    log.info("render_submitted", { attempt: claim.submit_attempts, render: job.renders + 1 });
    return { retryAfterSeconds: POLL_DELAY_SECONDS.early };
  }

  if (result.failure.transient && claim.submit_attempts < SUBMIT_ATTEMPTS) {
    // A refused call bills nothing, so a network error, a 5xx or a 429 is worth another go.
    await db.prepare("UPDATE tryon_jobs SET submit_started_at = NULL WHERE id = ?1").bind(job.id).run();
    log.warn("render_submit_retry", { attempt: claim.submit_attempts, detail: result.failure.detail });
    return { retryAfterSeconds: SUBMIT_RETRY_DELAY_SECONDS * claim.submit_attempts };
  }
  return fail(step, result.failure);
}

/**
 * The same photograph in the same look, made before and still held: its image is copied to this job, which is ready
 * at once, and YouCam is not asked again. Null when there is none to copy.
 */
async function copyOfMadeBefore(step: Step, renderKey: string): Promise<Next | null> {
  const { env, job } = step;
  const earlier = await env.DB.prepare(
    `SELECT result_key FROM tryon_jobs
     WHERE render_key = ?1 AND state = 'ready' AND result_key IS NOT NULL AND id <> ?2
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(renderKey, job.id)
    .first<{ result_key: string }>();
  if (earlier === null) return null;
  const stored = await env.RESULTS.get(earlier.result_key);
  if (stored === null) return null;
  const bytes = new Uint8Array(await stored.arrayBuffer());
  const info = inspectImage(bytes);
  if (info === null) return null;
  step.log.info("render_copied", { bytes: bytes.byteLength });
  return storeResult(step, { result: { ok: true, bytes, contentType: info.type }, attempts: 0, from: "queued" });
}

async function poll(step: Step): Promise<Next> {
  const { env, deps, job } = step;
  if (job.provider_task_id === null) {
    return fail(step, { code: "render_failed", transient: false, alert: true, detail: "rendering without a task" });
  }
  const elapsed = deps.now().getTime() - Date.parse(job.submitted_at ?? job.created_at);
  const result = await deps.image.poll(job.provider_task_id);

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
    const downloading = { ...job, state: "downloading", provider_result_url: result.resultUrl } as const;
    return download({ ...step, job: { ...downloading, provider_result_expires_at: expiresAt } });
  }

  const withinDeadline = elapsed <= RENDER_GIVE_UP_MS;
  if (result.state === "failed" && result.failure.retryOnce === true) return renderAgain(step, result.failure);
  if (result.state === "failed" && !(result.failure.transient && withinDeadline)) return fail(step, result.failure);
  if (!withinDeadline) {
    const detail = `no result ${String(Math.round(elapsed / MINUTE_MS))} min after submitting; task ${job.provider_task_id}`;
    return renderAgain(step, { code: "render_failed", transient: false, alert: true, detail });
  }
  return { retryAfterSeconds: elapsed < POLL_SLOWDOWN_AFTER_MS ? POLL_DELAY_SECONDS.early : POLL_DELAY_SECONDS.late };
}

/** A render YouCam's model failed, or that ran out of time, is made once more from the start; after that it fails. */
async function renderAgain(step: Step, failure: RenderFailure): Promise<Next> {
  const { env, log, job } = step;
  if (job.renders >= RENDER_ATTEMPTS) return fail(step, failure);
  const requeued = await env.DB.prepare(
    `UPDATE tryon_jobs SET state = 'queued', submit_started_at = NULL, submit_attempts = 0, provider_task_id = NULL,
       submitted_at = NULL
     WHERE id = ?1 AND state = 'rendering'`,
  )
    .bind(job.id)
    .run();
  if (requeued.meta.changes === 0) return DONE;
  log.warn("render_again", { render: job.renders, detail: failure.detail });
  return { retryAfterSeconds: SUBMIT_RETRY_DELAY_SECONDS };
}

async function download(step: Step): Promise<Next> {
  const { env, deps, log, job } = step;
  const db = env.DB;
  const now = deps.now();
  const url = job.provider_result_url;
  const expiresAt = Date.parse(job.provider_result_expires_at ?? "");
  if (url === null || !(expiresAt > now.getTime())) {
    const detail = "result URL expired before the image was downloaded: a billed image is lost";
    return fail(step, { code: "render_failed", transient: false, alert: true, detail });
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
    return fail(step, { code: "render_failed", transient: false, alert: true, detail: result.detail });
  }
  if (!result.ok) {
    log.warn("render_download_failed", { attempts, detail: result.detail });
    // The queue tries again soon; after that the sweeper keeps trying until the URL expires.
    return attempts < DOWNLOAD_QUEUE_RETRIES ? { retryAfterSeconds: DOWNLOAD_RETRY_DELAY_SECONDS } : DONE;
  }

  return storeResult(step, { result, attempts, from: "downloading" });
}

/**
 * Stores a look and releases the message a gate left waiting for it; a job that moved on while this ran keeps no
 * result. `from` is the state the job is stored from: downloading a render, or queued for a copy of one made before.
 */
async function storeResult(
  step: Step,
  {
    result,
    attempts,
    from,
  }: {
    result: Extract<DownloadResult, { ok: true }>;
    attempts: number;
    from: "downloading" | "queued";
  },
): Promise<Next> {
  const { env, deps, log, job, options } = step;
  const db = env.DB;
  const resultKey = `results/${job.id}.${fileExtension(result.contentType)}`;
  await env.RESULTS.put(resultKey, result.bytes, { httpMetadata: { contentType: result.contentType } });

  const readyAt = deps.now();
  const latencyMs = readyAt.getTime() - Date.parse(job.submitted_at ?? job.created_at);
  const [stored, queued] = await db.batch([
    db
      .prepare(
        `UPDATE tryon_jobs SET state = 'ready', result_key = ?2, expires_at = ?3, latency_ms = ?4
         WHERE id = ?1 AND state = ?5`,
      )
      .bind(
        job.id,
        resultKey,
        new Date(readyAt.getTime() + options.resultRetentionDays * DAY_MS).toISOString(),
        latencyMs,
        from,
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
  log.info("render_ready", { latency_ms: latencyMs, bytes: result.bytes.byteLength, attempts });
  // A render made is the key and the units working again.
  if (from === "downloading") await Promise.all(Object.values(TRYON_PAUSED_KEYS).map((key) => deps.resolveAlert(key)));

  for (const row of (queued?.results ?? []) as { id: string }[]) {
    const body = { message_id: row.id, request_id: job.request_id } satisfies MessagingMessage;
    await enqueue(env.MESSAGE_QUEUE, body, { log, ifLost: "sweeper" });
  }
  return DONE;
}

async function fail(step: Step, failure: RenderFailure): Promise<Next> {
  const { env, deps, log, job } = step;
  const changed = await failJob({
    db: env.DB,
    jobId: job.id,
    code: failure.code,
    reason: failure.reason ?? null,
    detail: failure.detail,
    now: deps.now(),
  });
  if (changed) {
    log.warn("render_failed", { code: failure.code, reason: failure.reason ?? null, detail: failure.detail });
    const message = `Try-on job ${job.id} failed (${failure.reason ?? failure.code}): ${failure.detail}`;
    if (failure.urgentKey !== undefined) await deps.alertOnce({ key: failure.urgentKey, message });
    else if (failure.alert) await deps.alert(message);
  }
  return DONE;
}
