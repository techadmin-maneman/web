// POST /api/tryon/generate and GET /api/tryon/status/:job_id.
//
// A look is made only for a try-on the gate has claimed, since the number is
// where it goes: to WhatsApp only, never to the site
// (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md). It is made for
// the stage the claim gave, the lead's extent of hair loss too. One look per
// visitor (the owner's decision, docs/decisions/0018-one-look-pro-only-lead-notices.md):
// the first generate for an upload renders it; the same look asked for again
// returns that job; any other look is refused. The mm_look cookie then keeps
// the browser from starting another photo.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../../http/context.ts";
import { PRESET_IDS, findPreset } from "../../config/presets.ts";
import { FAILURE_CODES, HAIR_COLORS, JOB_STATES, UNKNOWN_COLOR_ROUTE } from "../../config/tryon.ts";
import { alertCeilingReached, takeFromCeiling } from "../../domain/ceilings.ts";
import { takeOne } from "../../domain/rate-limit.ts";
import { chooseRender } from "../../domain/render-choice.ts";
import { failJob, loadJob, type JobRow, type RenderChoice } from "../../domain/tryon.ts";
import { errorBody, errorResponse, refuse } from "../../http/errors.ts";
import { setLookCookie } from "../../http/look-cookie.ts";
import { visitorOf } from "../../http/visitor.ts";
import { DAY_MS } from "../../lib/durations.ts";
import { LOOK_PER_NUMBER_DAYS, tryOnRuns } from "../../policy/tryon-delivery.ts";
import { enqueue } from "../../domain/enqueue.ts";
import type { RenderMessage } from "../../queues/render.ts";

const GenerateRequestSchema = z
  .object({
    job_id: z.uuid(),
    preset: z.enum(PRESET_IDS),
    hair_color: z
      .enum(HAIR_COLORS)
      .openapi({ description: "From the browser's detector; unknown if it could not tell." }),
  })
  .strict()
  .openapi("GenerateRequest", { description: "The look, for the stage the gate's claim gave the try-on." });

const JobStatusSchema = z
  .object({
    job_id: z.uuid(),
    state: z.enum(JOB_STATES),
    failure_code: z.enum(FAILURE_CODES).optional().openapi({ description: "Only when state is failed." }),
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
    const { deps, requestId } = c.var;
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
    if (!tryOnRuns(settings.messaging)) return refuse(c, "whatsapp_unavailable");

    const choice = chooseRender(job.stage, preset, request.hair_color, UNKNOWN_COLOR_ROUTE);
    const outcome = job.state === "awaiting_upload" ? await startFirstLook(c, job, choice) : sameLookAgain(job, choice);

    if ("error" in outcome) return c.json(errorBody(outcome.error, requestId), outcome.status);
    return c.json(outcome, 202);
  });

  app.openapi(statusRoute, async (c) => {
    const job = await loadJob(c.env.DB, c.req.valid("param").job_id);
    if (job === null) return refuse(c, "not_found");
    return c.json(statusOf(job), 200);
  });
}

export function statusOf(job: Pick<JobRow, "id" | "state" | "failure_code">): JobStatus {
  return job.state === "failed" && job.failure_code !== null
    ? { job_id: job.id, state: job.state, failure_code: job.failure_code }
    : { job_id: job.id, state: job.state };
}

type Outcome =
  JobStatus | { readonly error: "upload_missing" | "look_limit_reached" | "busy"; readonly status: 403 | 409 | 503 };

async function startFirstLook(c: Context<AppEnv>, job: JobRow, choice: RenderChoice): Promise<Outcome> {
  const db = c.env.DB;
  const now = c.var.deps.now();
  if (job.uploaded_at === null) return { error: "upload_missing", status: 409 };

  // One look per number: another of its jobs asked for since its claim's window opened refuses this one, in the
  // statement that queues it, so jobs claimed together cannot each start one.
  const since = new Date(now.getTime() - LOOK_PER_NUMBER_DAYS * DAY_MS).toISOString();
  const queued = await db
    .prepare(
      `UPDATE tryon_jobs SET stage = ?2, preset = ?3, hair_color = ?4, endpoint = ?5, provider_color = ?6,
         color_route = ?7, state = 'queued'
       WHERE id = ?1 AND state = 'awaiting_upload' AND uploaded_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM tryon_jobs other WHERE other.person_id = tryon_jobs.person_id
           AND other.id <> ?1 AND other.claimed_at >= ?8 AND other.state NOT IN ('awaiting_upload', 'failed'))
       RETURNING id`,
    )
    .bind(job.id, ...choiceValues(choice), since)
    .first();
  if (queued === null) {
    // A second request queued it first, or another of the number's jobs has its look.
    const current = await loadJob(db, job.id);
    if (current?.state === "awaiting_upload") return { error: "look_limit_reached", status: 403 };
    return statusOf(current ?? job);
  }

  const at = { now, settings: c.var.config.settings };
  if (!(await takeFromCeiling(db, "render", at))) {
    await failJob(db, job.id, "busy", null, now);
    await alertCeilingReached(db, c.var.deps.alert, "render", at);
    return { error: "busy", status: 503 };
  }

  await enqueueRender(c, job.id);
  await setLookCookie(c, job.id);
  c.var.log.info("tryon_render_queued", { job_id: job.id, endpoint: choice.endpoint, color_route: choice.colorRoute });
  return { job_id: job.id, state: "queued" };
}

/** A job already asked for: the same look returns it; any other is refused. */
function sameLookAgain(job: JobRow, choice: RenderChoice): Outcome {
  const sameLook = job.preset === choice.preset && job.hair_color === choice.hairColor;
  return sameLook ? statusOf(job) : { error: "look_limit_reached", status: 403 };
}

function choiceValues(choice: RenderChoice): string[] {
  return [choice.stage, choice.preset, choice.hairColor, choice.endpoint, choice.providerColor, choice.colorRoute];
}

async function enqueueRender(c: Context<AppEnv>, jobId: string): Promise<void> {
  const body = { job_id: jobId, request_id: c.var.requestId } satisfies RenderMessage;
  await enqueue(c.env.RENDER_QUEUE, body, { log: c.var.log, ifLost: "sweeper" });
}
