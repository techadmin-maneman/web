// The technician's day and the job he is on (src/policy/job-visibility.ts,
// in-job-steps.ts, check-in.ts, no-show.ts):
//
//   GET  /api/tech/jobs?date=                    the day's jobs; today and tomorrow in full
//   GET  /api/tech/jobs/:id                      one job, under the day-before unlock
//   POST /api/tech/jobs/:id/checkin              I have arrived, with the geofence
//   POST /api/tech/jobs/:id/start                start the job
//   POST /api/tech/jobs/:id/photos/upload-url    a link to PUT one photograph to
//   PUT  /api/tech/photos/:token                 the photograph itself
//   POST /api/tech/jobs/:id/photos               the set is complete: attach it to FSM
//   POST /api/tech/jobs/:id/checklist            the service checklist
//   POST /api/tech/jobs/:id/consumables          what was used, with quantities
//   POST /api/tech/jobs/:id/piece                the piece fitted, or the one that failed
//   POST /api/tech/jobs/:id/outcome              done, or partial with a reason
//   POST /api/tech/jobs/:id/no-show              refused before the wait ends
//
// "Every write accepts the client-generated X-Client-Event-Id, which is
// idempotent": a phone replaying its outbox lands each event once and gets the
// first answer back (docs/decisions/0038-offline-writes.md).
//
// No response here carries an amount.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../app.ts";
import { checklistIds, isPartialReason, CHECKLIST, PARTIAL_REASONS } from "../config/job-sheet.ts";
import { isPieceCode } from "../config/pieces.ts";
import { BOOKING_WINDOWS } from "../config/scheduling.ts";
import { VISIT_TYPES, type VisitType } from "../config/visit-types.ts";
import { latestArrival, recordArrival } from "../domain/check-ins.ts";
import { landJobEvent, stepsFor, type Landing } from "../domain/job-events.ts";
import { closeAsNoShow } from "../domain/no-shows.ts";
import { jobDetail, jobsOn, progressOf, workableJob, type WorkableJob } from "../domain/tech-jobs.ts";
import { anglesHeld, MAX_PHOTO_BYTES, slotOfLink, storeTechnicianPhoto, uploadLink } from "../domain/tech-photos.ts";
import { ANGLES, PHASES } from "../domain/visit-photos.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { requireTechnicianSession, technicianOf } from "../http/technician-session.ts";
import { indiaDate } from "../lib/india-time.ts";
import { CHECKIN_RADIUS_M } from "../policy/check-in.ts";
import { JOB_EVENT_KINDS, type JobEventKind } from "../policy/in-job-steps.ts";
import { waitEndsAt } from "../policy/no-show.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });
const jobId = z.object({ id: z.uuid() });

/** The header every write carries, so a replay lands once. */
const EVENT_ID_HEADER = "X-Client-Event-Id";
const EventIdSchema = z
  .object({ "x-client-event-id": z.string().regex(/^[A-Za-z0-9_-]{8,64}$/) })
  .openapi({ description: "The phone's own ID for this write; a replay of it changes nothing." });

const JobSummarySchema = z
  .object({
    id: z.uuid(),
    day: z.enum(["today", "tomorrow", "later"]),
    date: z.iso.date(),
    starts_at: z.iso.datetime(),
    ends_at: z.union([z.iso.datetime(), z.null()]),
    window_label: z.enum(BOOKING_WINDOWS),
    type: z.union([z.enum(VISIT_TYPES), z.null()]),
    sector: z.union([z.string(), z.null()]).openapi({ description: "The area, never the street." }),
    status: z.enum(["scheduled", "dispatched", "in_progress", "completed", "cancelled", "terminated", "other"]),
    badge: z.enum(["prepaid", "credit"]).openapi({ description: "No response to a technician carries an amount." }),
    unlocked: z.boolean(),
    unlocks_at: z.iso.datetime(),
  })
  .strict()
  .openapi("TechnicianJob");

const JobsSchema = z
  .object({ date: z.iso.date(), jobs: z.array(JobSummarySchema) })
  .strict()
  .openapi("TechnicianJobs", { description: "Jobs further out carry only time, type and sector." });

const ProgressSchema = z
  .object({
    checked_in_at: z.union([z.iso.datetime(), z.null()]),
    started_at: z.union([z.iso.datetime(), z.null()]),
    steps_done: z.array(z.enum(JOB_EVENT_KINDS)),
    outcome: z.union([z.string(), z.null()]),
  })
  .strict()
  .openapi("TechnicianJobProgress");

const JobDetailSchema = JobSummarySchema.extend({
  address: z
    .union([
      z
        .object({
          line1: z.string(),
          line2: z.union([z.string(), z.null()]),
          locality: z.string(),
          city: z.string(),
          pincode: z.string(),
          lat: z.union([z.number(), z.null()]),
          lng: z.union([z.number(), z.null()]),
        })
        .strict(),
      z.null(),
    ])
    .openapi({ description: "Null until the day before the visit; the API enforces it, not the screen." }),
  access_notes: z.union([z.string(), z.null()]),
  client: z
    .union([
      z.object({ name: z.string(), mobile: z.string(), note: z.union([z.string(), z.null()]) }).strict(),
      z.null(),
    ])
    .openapi({ description: "Null until the day before the visit." }),
  progress: ProgressSchema,
  steps: z.array(z.enum(JOB_EVENT_KINDS)).openapi({ description: "The steps this visit type runs, in order." }),
  checklist: z.array(z.object({ id: z.string(), label: z.string() }).strict()),
  partial_reasons: z.array(z.enum(PARTIAL_REASONS)),
}).openapi("TechnicianJobDetail");

const AcceptedSchema = z
  .object({
    event_id: z.string(),
    replayed: z.boolean().openapi({ description: "True when this write had already landed." }),
    fsm_write_state: z.enum(["pending", "written", "rejected"]),
    progress: ProgressSchema,
  })
  .strict()
  .openapi("TechnicianWriteAccepted");

const CheckInRequestSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy_m: z.number().min(0).max(100_000).nullable().optional(),
    at: z.iso.datetime().optional().openapi({ description: "The phone's clock; ours is used when it is left out." }),
  })
  .strict()
  .openapi("CheckInRequest");

const CheckInSchema = z
  .object({
    passed: z.boolean(),
    distance_m: z.union([z.number().int(), z.null()]).openapi({
      description: "Null when the address has no coordinates, so nothing could be measured.",
    }),
    radius_m: z.number().int(),
    checked_in_at: z.iso.datetime(),
    wait_ends_at: z
      .union([z.iso.datetime(), z.null()])
      .openapi({ description: "When the job may be closed as a no-show; null when the check-in failed." }),
    accepted: z.union([AcceptedSchema, z.null()]),
  })
  .strict()
  .openapi("CheckIn");

const UploadUrlRequestSchema = z
  .object({ phase: z.enum(PHASES), angle: z.enum(ANGLES) })
  .strict()
  .openapi("TechnicianPhotoUrlRequest");

const UploadUrlSchema = z
  .object({
    upload_url: z.string().openapi({ description: "A path on this host. PUT the photograph there." }),
    expires_at: z.iso.datetime(),
  })
  .strict()
  .openapi("TechnicianPhotoUrl");

const PhotosRequestSchema = z
  .object({ phase: z.enum(PHASES) })
  .strict()
  .openapi("TechnicianPhotosRequest");

const ChecklistRequestSchema = z
  .object({ done: z.array(z.string().min(1).max(64)).max(20) })
  .strict()
  .openapi("ChecklistRequest");

const ConsumablesRequestSchema = z
  .object({
    items: z
      .array(z.object({ name: z.string().min(1).max(80), quantity: z.number().int().min(1).max(999) }).strict())
      .max(30),
  })
  .strict()
  .openapi("ConsumablesRequest");

const PieceRequestSchema = z
  .object({
    piece_code: z.string().min(3).max(40),
    base: z.string().min(1).max(60).nullable().optional(),
    supplier_lot: z.string().min(1).max(60).nullable().optional(),
    failure_reason: z.string().min(1).max(200).nullable().optional(),
  })
  .strict()
  .openapi("PieceRequest", { description: "A failure_reason marks the piece that came off as failed." });

const OutcomeRequestSchema = z
  .discriminatedUnion("outcome", [
    z.object({ outcome: z.literal("done") }).strict(),
    z.object({ outcome: z.literal("partial"), reason: z.enum(PARTIAL_REASONS) }).strict(),
  ])
  .openapi("OutcomeRequest");

const NoShowSchema = z
  .object({
    closed: z.boolean(),
    wait_ends_at: z.iso.datetime(),
    case_id: z.union([z.uuid(), z.null()]),
    accepted: z.union([AcceptedSchema, z.null()]),
  })
  .strict()
  .openapi("NoShowClose");

const jobsRoute = createRoute({
  method: "get",
  path: "/api/tech/jobs",
  summary: "The technician's jobs on a date. Today and tomorrow in full; later dates only time, type and sector",
  request: { query: z.object({ date: z.iso.date().optional() }) },
  responses: {
    200: { description: "The day's jobs, in time order", ...json(JobsSchema) },
    401: errorResponse("session_required; device_revoked"),
  },
});

const jobRoute = createRoute({
  method: "get",
  path: "/api/tech/jobs/{id}",
  summary: "One of the technician's jobs, with the day-before unlock enforced",
  request: { params: jobId },
  responses: {
    200: { description: "The job", ...json(JobDetailSchema) },
    401: errorResponse("session_required; device_revoked"),
    404: errorResponse("not_found: no such job of this technician's"),
  },
});

const checkinRoute = createRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/checkin",
  summary: "I have arrived: the time and the phone's position, inside the geofence",
  request: { params: jobId, headers: EventIdSchema, body: { required: true, ...json(CheckInRequestSchema) } },
  responses: {
    200: { description: "Pass or fail, with the distance", ...json(CheckInSchema) },
    400: errorResponse("invalid_request: see error.fields"),
    401: errorResponse("session_required; device_revoked: ops revoked this phone, so drop the cached jobs"),
    404: errorResponse("not_found: no such job"),
    409: errorResponse("superseded: FSM moved the job; out_of_order: send the step before this one first"),
  },
});

const startRoute = createRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/start",
  summary: "Start the job. The duration runs from here to the outcome",
  request: { params: jobId, headers: EventIdSchema },
  responses: {
    202: { description: "Recorded", ...json(AcceptedSchema) },
    400: errorResponse("invalid_request: see error.fields"),
    401: errorResponse("session_required; device_revoked: ops revoked this phone, so drop the cached jobs"),
    404: errorResponse("not_found: no such job"),
    409: errorResponse("superseded: FSM moved the job; out_of_order: send the step before this one first"),
  },
});

const uploadUrlRoute = createRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/photos/upload-url",
  summary: "A link to PUT one photograph to, for one phase and angle",
  request: { params: jobId, body: { required: true, ...json(UploadUrlRequestSchema) } },
  responses: {
    201: { description: "The link, good for fifteen minutes", ...json(UploadUrlSchema) },
    400: errorResponse("invalid_request"),
    401: errorResponse("session_required; device_revoked"),
    404: errorResponse("not_found"),
  },
});

const uploadRoute = createRoute({
  method: "put",
  path: "/api/tech/photos/{token}",
  summary: "The photograph itself: a JPEG or PNG, at most 12 MB",
  request: { params: z.object({ token: z.string().min(1).max(500) }) },
  responses: {
    204: { description: "Received" },
    401: errorResponse("session_required; device_revoked"),
    404: errorResponse("not_found: the link is wrong or expired"),
    422: errorResponse("photo_invalid_file: not a JPEG or PNG, or over 12 MB"),
  },
});

const photosRoute = createRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/photos",
  summary: "The phase's five photographs are in; attach them to FSM",
  request: { params: jobId, headers: EventIdSchema, body: { required: true, ...json(PhotosRequestSchema) } },
  responses: {
    202: { description: "Recorded", ...json(AcceptedSchema) },
    400: errorResponse("invalid_request: see error.fields"),
    401: errorResponse("session_required; device_revoked: ops revoked this phone, so drop the cached jobs"),
    404: errorResponse("not_found: no such job"),
    409: errorResponse("superseded: FSM moved the job; out_of_order: send the step before this one first"),
  },
});

const checklistRoute = createRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/checklist",
  summary: "The service checklist, per visit type",
  request: { params: jobId, headers: EventIdSchema, body: { required: true, ...json(ChecklistRequestSchema) } },
  responses: {
    202: { description: "Recorded", ...json(AcceptedSchema) },
    400: errorResponse("invalid_request: see error.fields"),
    401: errorResponse("session_required; device_revoked: ops revoked this phone, so drop the cached jobs"),
    404: errorResponse("not_found: no such job"),
    409: errorResponse("superseded: FSM moved the job; out_of_order: send the step before this one first"),
  },
});

const consumablesRoute = createRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/consumables",
  summary: "Consumables used, with quantities",
  request: { params: jobId, headers: EventIdSchema, body: { required: true, ...json(ConsumablesRequestSchema) } },
  responses: {
    202: { description: "Recorded", ...json(AcceptedSchema) },
    400: errorResponse("invalid_request: see error.fields"),
    401: errorResponse("session_required; device_revoked: ops revoked this phone, so drop the cached jobs"),
    404: errorResponse("not_found: no such job"),
    409: errorResponse("superseded: FSM moved the job; out_of_order: send the step before this one first"),
  },
});

const pieceRoute = createRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/piece",
  summary: "The piece: a replacement's and a first fit's step only",
  request: { params: jobId, headers: EventIdSchema, body: { required: true, ...json(PieceRequestSchema) } },
  responses: {
    202: { description: "Recorded", ...json(AcceptedSchema) },
    400: errorResponse("invalid_request: see error.fields"),
    401: errorResponse("session_required; device_revoked: ops revoked this phone, so drop the cached jobs"),
    404: errorResponse("not_found: no such job"),
    409: errorResponse("superseded: FSM moved the job; out_of_order: send the step before this one first"),
  },
});

const outcomeRoute = createRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/outcome",
  summary: "Done, or partial with a reason",
  request: { params: jobId, headers: EventIdSchema, body: { required: true, ...json(OutcomeRequestSchema) } },
  responses: {
    202: { description: "Recorded", ...json(AcceptedSchema) },
    400: errorResponse("invalid_request: see error.fields"),
    401: errorResponse("session_required; device_revoked: ops revoked this phone, so drop the cached jobs"),
    404: errorResponse("not_found: no such job"),
    409: errorResponse("superseded: FSM moved the job; out_of_order: send the step before this one first"),
  },
});

const noShowRoute = createRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/no-show",
  summary: "Close the job as a no-show, once the wait has run",
  request: { params: jobId, headers: EventIdSchema },
  responses: {
    200: { description: "Closed, with the case ops will rule on", ...json(NoShowSchema) },
    400: errorResponse("invalid_request: see error.fields"),
    401: errorResponse("session_required; device_revoked: ops revoked this phone, so drop the cached jobs"),
    404: errorResponse("not_found: no such job"),
    409: errorResponse("superseded: FSM moved the job; out_of_order: send the step before this one first"),
    425: errorResponse("too_early_to_close: the wait has not run out"),
  },
});

export function registerTechJobs(app: App): void {
  for (const path of ["/api/tech/jobs", "/api/tech/jobs/*", "/api/tech/photos/*"]) {
    app.use(path, requireTechnicianSession);
  }

  app.openapi(jobsRoute, async (c) => {
    const { technicianId } = technicianOf(c);
    const now = c.var.deps.now();
    const date = c.req.valid("query").date ?? indiaDate(now);
    return c.json({ date, jobs: await jobsOn(c.env.DB, technicianId, date, now) }, 200);
  });

  app.openapi(jobRoute, async (c) => {
    const { technicianId } = technicianOf(c);
    const now = c.var.deps.now();
    const job = await jobDetail(c.env.DB, technicianId, c.req.valid("param").id, now);
    if (job === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    const type: VisitType = job.type ?? "service";
    return c.json(
      { ...job, steps: stepsFor(type), checklist: [...CHECKLIST[type]], partial_reasons: [...PARTIAL_REASONS] },
      200,
    );
  });

  app.openapi(checkinRoute, async (c) => {
    const { technicianId } = technicianOf(c);
    const { deps, requestId } = c.var;
    const now = deps.now();
    const body = c.req.valid("json");
    const job = await ownJob(c, c.req.valid("param").id);
    if (job === null) return c.json(errorBody("not_found", requestId), 404);

    const at = body.at === undefined ? now : new Date(body.at);
    const arrival = await recordArrival(c.env.DB, {
      appointmentId: job.id,
      technicianId,
      personId: job.personId,
      device: { lat: body.lat, lng: body.lng },
      accuracyM: body.accuracy_m ?? null,
      at,
      now,
      radiusM: CHECKIN_RADIUS_M,
    });
    c.var.log.info("technician_checked_in", {
      appointment_id: job.id,
      passed: arrival.passed,
      distance_m: arrival.distanceM,
      radius_m: arrival.radiusM,
    });
    if (!arrival.passed) {
      return c.json(
        {
          passed: false,
          distance_m: arrival.distanceM,
          radius_m: arrival.radiusM,
          checked_in_at: arrival.at,
          wait_ends_at: null,
          accepted: null,
        },
        200,
      );
    }

    const landing = await land(c, job, "check_in", { at: arrival.at, distance_m: arrival.distanceM });
    if (!landing.ok) return c.json(errorBody(landing.code, requestId, landing.fields), 409);
    return c.json(
      {
        passed: true,
        distance_m: arrival.distanceM,
        radius_m: arrival.radiusM,
        checked_in_at: arrival.at,
        wait_ends_at: waitEndsAt(at, job.type).toISOString(),
        accepted: landing.accepted,
      },
      200,
    );
  });

  app.openapi(startRoute, (c) => step(c, "start", () => ({})));

  app.openapi(uploadUrlRoute, async (c) => {
    const { technicianId } = technicianOf(c);
    const now = c.var.deps.now();
    const id = c.req.valid("param").id;
    const job = await jobDetail(c.env.DB, technicianId, id, now);
    if (job === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    const { phase, angle } = c.req.valid("json");
    const link = await uploadLink(c.var.config.settings.tryon.linkSigningKey, { appointmentId: id, phase, angle }, now);
    return c.json({ upload_url: link.url, expires_at: link.expiresAt.toISOString() }, 201);
  });

  app.openapi(uploadRoute, async (c) => {
    const { technicianId } = technicianOf(c);
    const { deps, requestId } = c.var;
    const now = deps.now();
    const slot = await slotOfLink(c.var.config.settings.tryon.linkSigningKey, c.req.valid("param").token, now);
    if (slot === null) return c.json(errorBody("not_found", requestId), 404);
    // The link names the job; the job must still be this technician's.
    const job = await workableJob(c.env.DB, slot.appointmentId);
    if (job?.technicianId !== technicianId) return c.json(errorBody("not_found", requestId), 404);

    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_PHOTO_BYTES) {
      return c.json(errorBody("photo_invalid_file", requestId), 422);
    }
    const stored = await storeTechnicianPhoto(c.env.DB, c.env.CLIENT_PHOTOS, slot, bytes, now, now);
    if (stored.kind === "not_an_image") return c.json(errorBody("photo_invalid_file", requestId), 422);
    c.var.log.info("technician_photo_stored", { appointment_id: slot.appointmentId, phase: slot.phase });
    return c.body(null, 204);
  });

  app.openapi(photosRoute, async (c) => {
    const phase = c.req.valid("json").phase;
    return step(c, phase === "before" ? "before_photos" : "after_photos", async (job) => ({
      phase,
      angles: await anglesHeld(c.env.DB, job.id, phase),
    }));
  });

  app.openapi(checklistRoute, (c) => {
    const { done } = c.req.valid("json");
    return step(c, "checklist", (job) => {
      const known = checklistIds(job.type);
      const unknown = done.filter((item) => !known.has(item));
      return unknown.length > 0 ? { invalid: ["done"] } : { done };
    });
  });

  app.openapi(consumablesRoute, (c) => {
    const { items } = c.req.valid("json");
    return step(c, "consumables", () => ({ items }));
  });

  app.openapi(pieceRoute, (c) => {
    const body = c.req.valid("json");
    return step(c, "piece", (job) => {
      if (!(stepsFor(job.type) as string[]).includes("piece")) return { invalid: ["piece_code"] };
      if (!isPieceCode(body.piece_code)) return { invalid: ["piece_code"] };
      return {
        piece_code: body.piece_code,
        base: body.base ?? null,
        supplier_lot: body.supplier_lot ?? null,
        failure_reason: body.failure_reason ?? null,
      };
    });
  });

  app.openapi(outcomeRoute, (c) => {
    const body = c.req.valid("json");
    return step(c, "outcome", () => {
      if (body.outcome === "partial" && !isPartialReason(body.reason)) return { invalid: ["reason"] };
      return body.outcome === "done" ? { outcome: "done" } : { outcome: "partial", reason: body.reason };
    });
  });

  app.openapi(noShowRoute, async (c) => {
    const { requestId, deps } = c.var;
    const now = deps.now();
    const job = await ownJob(c, c.req.valid("param").id);
    if (job === null) return c.json(errorBody("not_found", requestId), 404);

    const arrival = await latestArrival(c.env.DB, job.id);
    const closing = await closeAsNoShow(c.env.DB, {
      appointmentId: job.id,
      type: job.type,
      checkIn: arrival,
      now,
    });
    if (closing.kind === "no_check_in") return c.json(errorBody("out_of_order", requestId), 409);
    if (closing.kind === "too_early") return c.json(errorBody("too_early_to_close", requestId), 425);

    const landing = await land(c, job, "outcome", { outcome: "no_show", case_id: closing.caseId });
    if (!landing.ok) return c.json(errorBody(landing.code, requestId, landing.fields), 409);
    return c.json(
      {
        closed: true,
        wait_ends_at: closing.waitEndsAt,
        case_id: closing.caseId,
        accepted: landing.accepted,
      },
      200,
    );
  });
}

type Ctx = Context<AppEnv>;

/**
 * The job a write names. Not narrowed to this technician: a job that moved to
 * someone else is answered `superseded`, with what changed, so the phone can
 * tell him, rather than "not found".
 */
const ownJob = (c: Ctx, id: string): Promise<WorkableJob | null> => workableJob(c.env.DB, id);

/** What a step's handler returns: the event's body, or the fields that were wrong. */
type StepBody = Record<string, unknown> | { invalid: string[] };

/** One in-job step: check it, land it once, and put its FSM write on the queue. */
async function step(c: Ctx, kind: JobEventKind, build: (job: WorkableJob) => StepBody | Promise<StepBody>) {
  const job = await ownJob(c, c.req.param("id") ?? "");
  if (job === null) return c.json(errorBody("not_found", c.var.requestId), 404);
  const built = await build(job);
  if ("invalid" in built && Array.isArray(built.invalid)) {
    return c.json(errorBody("invalid_request", c.var.requestId, built.invalid), 400);
  }
  const landing = await land(c, job, kind, built);
  if (!landing.ok) return c.json(errorBody(landing.code, c.var.requestId, landing.fields), 409);
  return c.json(landing.accepted, 202);
}

/** What landing an event came to: the write, or the 409 the route answers. */
type Landed =
  | { readonly ok: true; readonly accepted: z.infer<typeof AcceptedSchema> }
  | { readonly ok: false; readonly code: "superseded" | "out_of_order"; readonly fields: string[] };

/** Records one event and queues its FSM write. */
async function land(c: Ctx, job: WorkableJob, kind: JobEventKind, body: Record<string, unknown>): Promise<Landed> {
  const { technicianId, deviceRowId } = technicianOf(c);
  const { requestId, deps } = c.var;
  const now = deps.now();
  const eventId = c.req.header(EVENT_ID_HEADER) ?? "";

  const landing: Landing = await landJobEvent(c.env.DB, {
    job,
    technicianId,
    deviceRowId,
    eventId,
    kind,
    body,
    occurredAt: now,
    now,
  });
  if (landing.kind === "superseded") {
    c.var.log.info("job_event_superseded", { appointment_id: job.id, kind, changed: landing.changed });
    return { ok: false, code: "superseded", fields: [...landing.changed] };
  }
  if (landing.kind === "out_of_order") return { ok: false, code: "out_of_order", fields: [landing.needs] };

  // A replay landed nothing new, so nothing new goes to FSM either.
  if (!landing.replayed) {
    await c.env.FSM_QUEUE.send({ job_event_id: landing.event.id, request_id: requestId } satisfies FsmSyncMessage);
  }
  return {
    ok: true,
    accepted: {
      event_id: landing.event.eventId,
      replayed: landing.replayed,
      fsm_write_state: landing.event.fsmWriteState,
      progress: await progressOf(c.env.DB, job.id),
    },
  };
}

/** The header the phone sends its event ID in. */
export const CLIENT_EVENT_ID_HEADER = EVENT_ID_HEADER;
