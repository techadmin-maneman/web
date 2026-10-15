// POST /api/tryon/generate and GET /api/tryon/status/:job_id.
//
// A look is made only for a try-on the gate has claimed, since the number is
// where it goes: to WhatsApp only, never to the site
// (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md). It is made for
// the stage the claim gave, the lead's extent of hair loss too. One look per
// visitor (docs/decisions/0018-one-look-pro-only-lead-notices.md):
// the first generate for an upload renders it; the same look asked for again
// returns that job; any other look is refused. The mm_look cookie then keeps
// the browser from starting another photo.

import { tryOnStopped } from "../../domain/platform/alerts.ts";
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../../http/context.ts";
import { PRESET_IDS, findPreset } from "../../config/presets.ts";
import { FAILURE_CODES, FAILURE_REASONS, HAIR_COLORS, JOB_STATES } from "../../config/tryon.ts";
import { withinCeiling } from "../../domain/platform/ceilings.ts";
import { takeOne } from "../../domain/sign-in/rate-limit.ts";
import { failJob, loadJob, type JobRow, type RenderChoice } from "../../domain/try-on/tryon.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { setLookCookie } from "../../http/look-cookie.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { visitorOf } from "../../http/visitor.ts";
import { DAY_MS } from "../../lib/durations.ts";
import { tryOnRuns } from "../../policy/tryon-delivery.ts";
import { enqueue } from "../../domain/platform/enqueue.ts";
import type { RenderMessage } from "../../queues/render.ts";

const GenerateRequestSchema = z
  .object({
    job_id: z.uuid(),
    preset: z.enum(PRESET_IDS),
    hair_color: z.enum(HAIR_COLORS).optional().openapi({
      deprecated: true,
      description: "Ignored: the look keeps the visitor's own colour. Taken from the site of the release before.",
    }),
  })
  .strict()
  .openapi("GenerateRequest", { description: "The look, for the stage the gate's claim gave the try-on." });

const JobStatusSchema = z
  .object({
    job_id: z.uuid(),
    state: z.enum(JOB_STATES),
    failure_code: z.enum(FAILURE_CODES).optional().openapi({ description: "Only when state is failed." }),
    failure_reason: z.enum(FAILURE_REASONS).optional().openapi({
      description: "Only when state is failed, and only where YouCam named the fault, or the try-on is paused.",
    }),
  })
  .strict()
  .openapi("JobStatus");

const generateRoute = createRoute({
  method: "post",
  path: "/api/tryon/generate",
  summary: "Render the look for an uploaded photo the gate has claimed: one look per visitor",
  request: { body: { required: true, content: { "application/json": { schema: GenerateRequestSchema } } } },
  responses: {
    202: {
      description: "Queued, or an identical job already exists. job_id may differ from the one sent.",
      content: { "application/json": { schema: JobStatusSchema } },
    },
    400: errorResponse("invalid_request: see error.fields"),
    403: errorResponse("look_limit_reached: this photo already has its look"),
    404: errorResponse("not_found"),
    409: errorResponse(
      "claim_required: the gate has not been given a number to send the look to; " +
        "upload_missing: the photo has not been uploaded, or has been deleted",
    ),
    429: errorResponse("rate_limited: too many renders from this address this hour"),
    503: errorResponse(
      "busy: today's render ceiling is reached; whatsapp_unavailable: WhatsApp cannot send the look, so none is made",
    ),
  },
});

const statusRoute = createRoute({
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
    const { deps } = c.var;
    const db = c.env.DB;
    const now = deps.now();

    const visitor = await visitorOf(c);
    const withinLimit = await takeOne(db, "tryon:generate:ip", visitor.ipHash, { now, settings });
    if (!withinLimit) return refuse(c, "rate_limited");

    const job = await loadJob(db, request.job_id);
    const preset = findPreset(request.preset);
    if (job === null) return refuse(c, "not_found");
    if (preset === undefined) return refuse(c, "invalid_request", ["preset"]);
    // The claim gives the job its lead and its stage.
    if (job.lead_id === null || job.stage === null) return refuse(c, "claim_required");
    if (!tryOnRuns(settings.messaging, await tryOnStopped(db))) return refuse(c, "whatsapp_unavailable");

    const choice = { stage: job.stage, preset: preset.id };
    const outcome = job.state === "awaiting_upload" ? await startFirstLook(c, job, choice) : sameLookAgain(job, choice);

    if ("error" in outcome) return refuse(c, outcome.error);
    return c.json(outcome, 202);
  });

  app.openapi(statusRoute, async (c) => {
    const job = await loadJob(c.env.DB, c.req.valid("param").job_id);
    if (job === null) return refuse(c, "not_found");
    return c.json(statusOf(job), 200);
  });
}

export function statusOf(job: Pick<JobRow, "id" | "state" | "failure_code" | "failure_reason">): JobStatus {
  if (job.state !== "failed" || job.failure_code === null) return { job_id: job.id, state: job.state };
  const failed = { job_id: job.id, state: job.state, failure_code: job.failure_code };
  return job.failure_reason === null ? failed : { ...failed, failure_reason: job.failure_reason };
}

type Outcome = JobStatus | { readonly error: "upload_missing" | "look_limit_reached" | "busy" };

async function startFirstLook(c: Context<AppEnv>, job: JobRow, choice: RenderChoice): Promise<Outcome> {
  const db = c.env.DB;
  const now = c.var.deps.now();
  if (job.uploaded_at === null) return { error: "upload_missing" };

  // One look per number: another of its jobs asked for since its claim's window opened refuses this one, in the
  // statement that queues it, so jobs claimed together cannot each start one.
  const since = new Date(now.getTime() - (await opsInputs(c)).tryonLookDays * DAY_MS).toISOString();
  const queued = await db
    .prepare(
      `UPDATE tryon_jobs SET stage = ?2, preset = ?3, state = 'queued'
       WHERE id = ?1 AND state = 'awaiting_upload' AND uploaded_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM tryon_jobs other WHERE other.person_id = tryon_jobs.person_id
           AND other.id <> ?1 AND other.claimed_at >= ?4 AND other.state NOT IN ('awaiting_upload', 'failed'))
       RETURNING id`,
    )
    .bind(job.id, choice.stage, choice.preset, since)
    .first();
  if (queued === null) {
    // A second request queued it first, or another of the number's jobs has its look.
    const current = await loadJob(db, job.id);
    if (current?.state === "awaiting_upload") return { error: "look_limit_reached" };
    return statusOf(current ?? job);
  }

  const at = { now, settings: c.var.config.settings };
  if (!(await withinCeiling(db, c.var.deps.alert, "render", at))) {
    await failJob({ db, jobId: job.id, code: "busy", detail: null, now });
    return { error: "busy" };
  }

  await enqueueRender(c, job.id);
  await setLookCookie(c, job.id);
  c.var.log.info("tryon_render_queued", { job_id: job.id, preset: choice.preset });
  return { job_id: job.id, state: "queued" };
}

/** A job already asked for: the same look returns it; any other is refused. */
function sameLookAgain(job: JobRow, choice: RenderChoice): Outcome {
  return job.preset === choice.preset ? statusOf(job) : { error: "look_limit_reached" };
}

async function enqueueRender(c: Context<AppEnv>, jobId: string): Promise<void> {
  const body = { job_id: jobId, request_id: c.var.requestId } satisfies RenderMessage;
  await enqueue(c.env.RENDER_QUEUE, body, { log: c.var.log, ifLost: "sweeper" });
}
