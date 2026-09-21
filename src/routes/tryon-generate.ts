// POST /api/tryon/generate and GET /api/tryon/status/:job_id.
//
// The first generate for an upload renders it. A later one with a different
// look is "try another look": it needs the session the gate set, and renders
// the same photo again as a new job, without a second gate or a second lead.
// An identical request returns the job that already exists.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../app.ts";
import { PRESET_IDS, findPreset } from "../config/presets.ts";
import { FAILURE_CODES, HAIR_COLORS, JOB_STATES, TRYON_STAGES, type JobState } from "../config/tryon.ts";
import { alertCeilingReached, takeFromCeiling } from "../domain/ceilings.ts";
import { takeOne } from "../domain/rate-limit.ts";
import { chooseRender } from "../domain/render-choice.ts";
import { failJob, loadJob, recordEvent, type JobRow, type RenderChoice } from "../domain/tryon.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { currentSession } from "../http/session.ts";
import { visitorOf } from "../http/visitor.ts";
import { indiaHour } from "../lib/india-time.ts";
import type { RenderMessage } from "../queues/render.ts";

export const GenerateRequestSchema = z
  .object({
    job_id: z.uuid(),
    stage: z.enum(TRYON_STAGES).openapi({ description: "The hair-loss stage the visitor picked." }),
    preset: z.enum(PRESET_IDS),
    hair_color: z
      .enum(HAIR_COLORS)
      .openapi({ description: "From the browser's detector; unknown if it could not tell." }),
  })
  .strict()
  .openapi("GenerateRequest");

export const JobStatusSchema = z
  .object({
    job_id: z.uuid(),
    state: z.enum(JOB_STATES),
    failure_code: z.enum(FAILURE_CODES).optional().openapi({ description: "Only when state is failed." }),
  })
  .strict()
  .openapi("JobStatus");

export const generateRoute = createRoute({
  method: "post",
  path: "/api/tryon/generate",
  summary: "Render a look: the first for an upload, or another look for the same photo",
  request: { body: { required: true, content: { "application/json": { schema: GenerateRequestSchema } } } },
  responses: {
    202: {
      description: "Queued, or an identical job already exists. job_id may differ from the one sent.",
      content: { "application/json": { schema: JobStatusSchema } },
    },
    400: errorResponse("invalid_request: see error.fields"),
    403: errorResponse("session_required: another look needs the session the gate set"),
    404: errorResponse("not_found"),
    409: errorResponse("upload_missing: the photo has not been uploaded, or has been deleted"),
    429: errorResponse("rate_limited: too many renders from this address this hour"),
    503: errorResponse("busy: today's render ceiling is reached"),
  },
});

export const statusRoute = createRoute({
  method: "get",
  path: "/api/tryon/status/{job_id}",
  summary: "Where a job stands",
  request: { params: z.object({ job_id: z.uuid() }) },
  responses: {
    200: { description: "The job's state", content: { "application/json": { schema: JobStatusSchema } } },
    404: errorResponse("not_found"),
  },
});

type JobStatus = z.infer<typeof JobStatusSchema>;

export function registerTryonGenerate(app: App): void {
  app.openapi(generateRoute, async (c) => {
    const request = c.req.valid("json");
    const { settings } = c.var.config;
    const { deps, requestId } = c.var;
    const db = c.env.DB;
    const now = deps.now();

    const visitor = await visitorOf(c);
    const withinLimit = await takeOne(db, {
      scope: "tryon:generate:ip",
      key: visitor.ipHash,
      window: indiaHour(now),
      limit: settings.tryon.generateIpHourlyLimit,
    });
    if (!withinLimit) return c.json(errorBody("rate_limited", requestId), 429);

    const job = await loadJob(db, request.job_id);
    const preset = findPreset(request.preset);
    if (job === null) return c.json(errorBody("not_found", requestId), 404);
    if (preset === undefined) return c.json(errorBody("invalid_request", requestId, ["preset"]), 400);

    const choice = chooseRender(request.stage, preset, request.hair_color, settings.tryon.unknownColorRoute);
    const outcome =
      job.state === "awaiting_upload"
        ? await startFirstLook(c, job, choice)
        : await startAnotherLook(c, job, choice, visitor.ipHash);

    if ("error" in outcome) return c.json(errorBody(outcome.error, requestId), outcome.status);
    return c.json(outcome, 202);
  });

  app.openapi(statusRoute, async (c) => {
    const job = await loadJob(c.env.DB, c.req.valid("param").job_id);
    if (job === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    return c.json(statusOf(job), 200);
  });
}

export function statusOf(job: Pick<JobRow, "id" | "state" | "failure_code">): JobStatus {
  return job.state === "failed" && job.failure_code !== null
    ? { job_id: job.id, state: job.state, failure_code: job.failure_code }
    : { job_id: job.id, state: job.state };
}

type Outcome =
  JobStatus | { readonly error: "upload_missing" | "session_required" | "busy"; readonly status: 403 | 409 | 503 };

async function startFirstLook(c: Context<AppEnv>, job: JobRow, choice: RenderChoice): Promise<Outcome> {
  const db = c.env.DB;
  const now = c.var.deps.now();
  if (job.uploaded_at === null) return { error: "upload_missing", status: 409 };

  const queued = await db
    .prepare(
      `UPDATE tryon_jobs SET stage = ?2, preset = ?3, hair_color = ?4, endpoint = ?5, provider_color = ?6,
         color_route = ?7, state = 'queued'
       WHERE id = ?1 AND state = 'awaiting_upload' AND uploaded_at IS NOT NULL
       RETURNING id`,
    )
    .bind(job.id, ...choiceValues(choice))
    .first();
  if (queued === null) {
    // A second request queued it first.
    const current = await loadJob(db, job.id);
    return statusOf(current ?? job);
  }

  const ceiling = c.var.config.settings.tryon.renderDailyCeiling;
  if (!(await takeFromCeiling(db, "render", ceiling, now))) {
    await failJob(db, job.id, "busy", null, now);
    await alertCeilingReached(db, c.var.deps.alert, "render", ceiling, now);
    return { error: "busy", status: 503 };
  }

  await enqueueRender(c, job.id);
  c.var.log.info("tryon_render_queued", { job_id: job.id, endpoint: choice.endpoint, color_route: choice.colorRoute });
  return { job_id: job.id, state: "queued" };
}

async function startAnotherLook(
  c: Context<AppEnv>,
  job: JobRow,
  choice: RenderChoice,
  ipHash: string,
): Promise<Outcome> {
  const db = c.env.DB;
  const now = c.var.deps.now();

  // The same look again: the job already covers it.
  const sameLook = job.preset === choice.preset && job.hair_color === choice.hairColor;
  if (sameLook && job.state !== "failed" && job.state !== "expired") return statusOf(job);

  const session = await currentSession(c);
  const ownsJob = session !== null && job.session_id === session.id;
  if (!ownsJob) return { error: "session_required", status: 403 };
  if (job.uploaded_at === null || job.upload_deleted_at !== null) return { error: "upload_missing", status: 409 };

  const existing = await db
    .prepare(
      `SELECT id, state, failure_code FROM tryon_jobs
       WHERE upload_key = ?1 AND preset = ?2 AND hair_color = ?3
         AND state IN ('queued', 'rendering', 'downloading', 'ready')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(job.upload_key, choice.preset, choice.hairColor)
    .first<{ id: string; state: JobState; failure_code: null }>();
  if (existing !== null) return statusOf(existing);

  const ceiling = c.var.config.settings.tryon.renderDailyCeiling;
  if (!(await takeFromCeiling(db, "render", ceiling, now))) {
    await alertCeilingReached(db, c.var.deps.alert, "render", ceiling, now);
    return { error: "busy", status: 503 };
  }

  const lookId = crypto.randomUUID();
  const firstLookId = job.parent_job_id ?? job.id;
  await db.batch([
    db
      .prepare(
        `INSERT INTO tryon_jobs (id, created_at, upload_key, uploaded_at, parent_job_id, stage, preset, hair_color,
           endpoint, provider_color, color_route, state, person_id, session_id, photo_consent_version,
           photo_consent_at, ip_hash, request_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'queued', ?12, ?13, ?14, ?15, ?16, ?17)`,
      )
      .bind(
        lookId,
        now.toISOString(),
        job.upload_key,
        job.uploaded_at,
        firstLookId,
        ...choiceValues(choice),
        session.person_id,
        session.id,
        job.photo_consent_version,
        job.photo_consent_at,
        ipHash,
        c.var.requestId,
      ),
    recordEvent(db, "try_on_additional_look", session.person_id, { job_id: lookId, first_job_id: firstLookId }, now),
  ]);

  await enqueueRender(c, lookId);
  c.var.log.info("try_on_additional_look", { job_id: lookId, first_job_id: firstLookId });
  return { job_id: lookId, state: "queued" };
}

function choiceValues(choice: RenderChoice): string[] {
  return [choice.stage, choice.preset, choice.hairColor, choice.endpoint, choice.providerColor, choice.colorRoute];
}

async function enqueueRender(c: Context<AppEnv>, jobId: string): Promise<void> {
  try {
    await c.env.RENDER_QUEUE.send({ job_id: jobId, request_id: c.var.requestId } satisfies RenderMessage);
  } catch (error) {
    // The job is safe in D1; the sweeper re-enqueues queued jobs that never started.
    c.var.log.warn("render_enqueue_failed", { job_id: jobId, error });
  }
}
