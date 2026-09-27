// The technician's day and the job he is on (src/policy/job-visibility.ts,
// in-job-steps.ts, check-in.ts, no-show.ts):
//
//   GET  /api/tech/jobs?date=                    the day's jobs; today and tomorrow in full
//   GET  /api/tech/jobs/:id                      one job, under the day-before unlock
//   GET  /api/tech/jobs/:id/last-visit-photo     the client's last visit, after (board A3)
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
// When a write happened is the phone's to say, within bounds, since a phone in
// a basement sends an hour's work at once (src/policy/phone-clock.ts): the
// check-in's own `at`, else the millisecond its event ID, a UUIDv7, begins with.
//
// No response here carries an amount.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../http/context.ts";
import { checklistIds, isPartialReason, CHECKLIST, PARTIAL_REASONS } from "../config/job-sheet.ts";
import { isPieceCode } from "../config/pieces.ts";
import { BOOKING_WINDOWS } from "../config/scheduling.ts";
import { VISIT_TYPES, type VisitType } from "../config/visit-types.ts";
import { latestArrival, recordArrival } from "../domain/check-ins.ts";
import { landJobEvent, type Landing } from "../domain/job-events.ts";
import { noShowReadiness, openNoShowCase } from "../domain/no-shows.ts";
import { jobDetail, jobsOn, lastVisitPhoto, progressOf, workableJob, type WorkableJob } from "../domain/tech-jobs.ts";
import { anglesHeld, MAX_PHOTO_BYTES, slotOfLink, storeTechnicianPhoto, uploadLink } from "../domain/tech-photos.ts";
import { ANGLES, PHASES } from "../domain/visit-photos.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { requireTechnicianSession, technicianOf } from "../http/technician-session.ts";
import { indiaDate } from "../lib/india-time.ts";
import { timeOfUuidV7 } from "../lib/uuidv7.ts";
import { JOB_EVENT_KINDS, stepsFor, type JobEventKind } from "../policy/in-job-steps.ts";
import { PAYMENT_BADGES } from "../policy/job-visibility.ts";
import { noShowWaitEnds } from "../policy/no-show.ts";
import { boundedPhoneTime } from "../policy/phone-clock.ts";
import { opsInputs } from "../http/ops-inputs.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";
import type { MessagingMessage } from "../queues/messaging.ts";
import { arrivalNotice } from "../domain/visit-messages.ts";
import { PieceSchema } from "./tech-pieces.ts";

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });
const jobId = z.object({ id: z.uuid() });

/** The header every write carries, so a replay lands once. */
const EVENT_ID_HEADER = "X-Client-Event-Id";
/** The job's start as the phone holds it, which a write may carry. */
const JOB_STARTS_AT_HEADER = "X-Job-Starts-At";
const EventIdSchema = z
  .object({
    "x-client-event-id": z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,64}$/)
      .openapi({
        description:
          "The phone's own ID for this write; a replay of it changes nothing. A UUIDv7 carries the moment it was queued.",
      }),
    "x-job-starts-at": z.iso.datetime().optional().openapi({
      description:
        "The job's starts_at as the phone holds it. When ops have moved the job since, the write is superseded, field time.",
    }),
  })
  .openapi({ description: "Every write's headers." });

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
    badge: z.enum(PAYMENT_BADGES).openapi({
      description:
        "Free for a visit the price book charges nothing for. No response to a technician carries an amount.",
    }),
    slots: z
      .union([z.number(), z.null()])
      .openapi({ description: "How much of the day the visit takes: 1, 1.5 or 2 slots. Null for an unknown type." }),
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
    wait_ends_at: z.union([z.iso.datetime(), z.null()]).openapi({
      description: "When the job may close as a no-show, from the check-in we hold; null before one landed.",
    }),
    distance_m: z.union([z.number().int(), z.null()]).openapi({
      description: "How far from the address that check-in was; null when nothing could be measured.",
    }),
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
          building: z.union([z.string(), z.null()]),
          tower: z.union([z.string(), z.null()]),
          floor: z.union([z.string(), z.null()]),
          flat: z.union([z.string(), z.null()]),
          landmark: z.union([z.string(), z.null()]),
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
  no_show_wait_min: z.number().int().openapi({
    description:
      "How long this visit's type waits before a no-show may be closed, so a phone with no signal can count it.",
  }),
  pieces: z
    .union([z.array(PieceSchema), z.null()])
    .openapi({ description: "The client's pieces, newest fit first. Null until the day before the visit." }),
  last_visit: z
    .union([
      z
        .object({
          date: z.iso.date(),
          technician: z.union([z.string(), z.null()]).openapi({ description: "The first name of who did it." }),
          photo_url: z.string().openapi({ description: "Its after photograph, never to be kept on the phone." }),
        })
        .strict(),
      z.null(),
    ])
    .openapi({ description: "The client's latest earlier visit with after photographs; null for a first visit." }),
  reminder: z
    .union([z.object({ delivered_at: z.union([z.iso.datetime(), z.null()]) }).strict(), z.null()])
    .openapi({ description: "The day-before or arrival WhatsApp to the client, and when it was delivered." }),
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
    at: z.iso.datetime().optional().openapi({
      description:
        "The phone's clock, kept within bounds and never later than we received it; left out, the event ID's time, else ours.",
    }),
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
    old_piece: z
      .object({ piece_code: z.string().min(3).max(40), failure_reason: z.string().min(1).max(200) })
      .strict()
      .nullable()
      .optional()
      .openapi({ description: "On a replacement: the piece that came off, and why it failed." }),
  })
  .strict()
  .openapi("PieceRequest", {
    description:
      "The piece fitted, with its base and lot, and on a replacement the one that came off. A failure_reason on the piece itself marks it as failed and fits nothing.",
  });

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

/** A step that landed, or had landed before. */
const RECORDED = { description: "Recorded", ...json(AcceptedSchema) };

/** What every in-job write can be refused with. A route with more to say of a conflict says it after these. */
const STEP_REFUSALS = {
  400: errorResponse("invalid_request: see error.fields"),
  401: errorResponse("session_required; device_revoked: ops revoked this phone, so drop the cached jobs"),
  404: errorResponse("not_found: no such job"),
  409: errorResponse("superseded: FSM moved the job; out_of_order: send the step before this one first"),
};

/** A check-in's or a start's conflict, which may also be on the wrong day. */
const DAY_CONFLICT = errorResponse(
  "superseded: FSM moved the job; out_of_order: send the step before this one first; not_today: the job is on another day",
);

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

const lastVisitPhotoRoute = createRoute({
  method: "get",
  path: "/api/tech/jobs/{id}/last-visit-photo",
  summary: "The client's last visit, after: one photograph, under the card's own unlock, never cached",
  request: { params: jobId },
  responses: {
    200: {
      description: "The image",
      content: { "image/jpeg": { schema: z.string() }, "image/png": { schema: z.string() } },
    },
    401: errorResponse("session_required; device_revoked"),
    404: errorResponse(
      "not_found: no such job of this technician's, not unlocked yet, or no earlier visit's photograph",
    ),
  },
});

const checkinRoute = createRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/checkin",
  summary: "I have arrived: the time and the phone's position, inside the geofence",
  request: { params: jobId, headers: EventIdSchema, body: { required: true, ...json(CheckInRequestSchema) } },
  responses: {
    200: { description: "Pass or fail, with the distance", ...json(CheckInSchema) },
    ...STEP_REFUSALS,
    409: DAY_CONFLICT,
  },
});

const startRoute = createRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/start",
  summary: "Start the job. The duration runs from here to the outcome",
  request: { params: jobId, headers: EventIdSchema },
  responses: {
    202: RECORDED,
    ...STEP_REFUSALS,
    409: DAY_CONFLICT,
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
    202: RECORDED,
    ...STEP_REFUSALS,
  },
});

const checklistRoute = createRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/checklist",
  summary: "The service checklist, per visit type",
  request: { params: jobId, headers: EventIdSchema, body: { required: true, ...json(ChecklistRequestSchema) } },
  responses: {
    202: RECORDED,
    ...STEP_REFUSALS,
  },
});

const consumablesRoute = createRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/consumables",
  summary: "Consumables used, with quantities",
  request: { params: jobId, headers: EventIdSchema, body: { required: true, ...json(ConsumablesRequestSchema) } },
  responses: {
    202: RECORDED,
    ...STEP_REFUSALS,
  },
});

const pieceRoute = createRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/piece",
  summary: "The piece: a replacement's and a first fit's step only",
  request: { params: jobId, headers: EventIdSchema, body: { required: true, ...json(PieceRequestSchema) } },
  responses: {
    202: RECORDED,
    ...STEP_REFUSALS,
  },
});

const outcomeRoute = createRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/outcome",
  summary: "Done, or partial with a reason",
  request: { params: jobId, headers: EventIdSchema, body: { required: true, ...json(OutcomeRequestSchema) } },
  responses: {
    202: RECORDED,
    ...STEP_REFUSALS,
  },
});

const noShowRoute = createRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/no-show",
  summary: "Close the job as a no-show, once the wait has run",
  request: { params: jobId, headers: EventIdSchema },
  responses: {
    200: { description: "Closed, with the case ops will rule on", ...json(NoShowSchema) },
    ...STEP_REFUSALS,
    409: errorResponse(
      "superseded: FSM moved the job; out_of_order: send the step before this one first; already_started: the job was started, so the client was home",
    ),
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
    const { addressUnlockHour } = await opsInputs(c);
    return c.json({ date, jobs: await jobsOn(c.env.DB, technicianId, date, now, addressUnlockHour) }, 200);
  });

  app.openapi(jobRoute, async (c) => {
    const { technicianId } = technicianOf(c);
    const inputs = await opsInputs(c);
    const job = await jobDetail(c.env.DB, {
      technicianId,
      jobId: c.req.valid("param").id,
      now: c.var.deps.now(),
      unlockHour: inputs.addressUnlockHour,
      waits: inputs.noShowWaitMin,
    });
    if (job === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    const type: VisitType = job.type ?? "service";
    return c.json(
      { ...job, steps: stepsFor(type), checklist: [...CHECKLIST[type]], partial_reasons: [...PARTIAL_REASONS] },
      200,
    );
  });

  app.openapi(lastVisitPhotoRoute, async (c) => {
    const photo = await lastVisitPhoto(c.env.DB, {
      technicianId: technicianOf(c).technicianId,
      jobId: c.req.valid("param").id,
      now: c.var.deps.now(),
      unlockHour: (await opsInputs(c)).addressUnlockHour,
    });
    const object = photo === null ? null : await c.env.CLIENT_PHOTOS.get(photo.key);
    if (photo === null || object === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    // A client's photograph stays off a technician's phone: neither the browser nor the service worker keeps it.
    return new Response(object.body, {
      headers: { "Content-Type": photo.contentType, "Cache-Control": "private, no-store" },
    });
  });

  app.openapi(checkinRoute, async (c) => {
    const { technicianId } = technicianOf(c);
    const { deps, requestId } = c.var;
    const now = deps.now();
    const body = c.req.valid("json");
    const job = await namedJob(c, c.req.valid("param").id);
    if (job === null) return c.json(errorBody("not_found", requestId), 404);

    const eventId = c.req.valid("header")["x-client-event-id"];
    const claimed = body.at === undefined ? timeOfUuidV7(eventId) : new Date(body.at);
    const at = boundedPhoneTime(claimed, { visitStart: job.windowStart, receivedAt: now });
    const inputs = await opsInputs(c);
    const arrival = await recordArrival(c.env.DB, {
      appointmentId: job.id,
      technicianId,
      personId: job.personId,
      device: { lat: body.lat, lng: body.lng },
      accuracyM: body.accuracy_m ?? null,
      at,
      claimedAt: claimed,
      now,
      radiusM: inputs.checkinRadiusM,
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

    const landing = await land(c, job, "check_in", { at: arrival.at, distance_m: arrival.distanceM }, at);
    if (!landing.ok) return c.json(errorBody(landing.code, requestId, landing.fields), 409);
    if (job.personId !== null) await tellOfArrival(c, { personId: job.personId, appointmentId: job.id, arrivedAt: at });
    return c.json(
      {
        passed: true,
        distance_m: arrival.distanceM,
        radius_m: arrival.radiusM,
        checked_in_at: arrival.at,
        wait_ends_at: noShowWaitEnds({ at, receivedAt: now }, job.type, inputs.noShowWaitMin).toISOString(),
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
    const inputs = await opsInputs(c);
    const job = await jobDetail(c.env.DB, {
      technicianId,
      jobId: id,
      now,
      unlockHour: inputs.addressUnlockHour,
      waits: inputs.noShowWaitMin,
    });
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
      const oldPiece = body.old_piece ?? null;
      if (oldPiece !== null && !isPieceCode(oldPiece.piece_code)) return { invalid: ["old_piece"] };
      return {
        piece_code: body.piece_code,
        base: body.base ?? null,
        supplier_lot: body.supplier_lot ?? null,
        failure_reason: body.failure_reason ?? null,
        old_piece: oldPiece,
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
    const job = await namedJob(c, c.req.valid("param").id);
    if (job === null) return c.json(errorBody("not_found", requestId), 404);

    const readiness = noShowReadiness(
      await latestArrival(c.env.DB, job.id),
      job.type,
      now,
      (await opsInputs(c)).noShowWaitMin,
    );
    if (readiness.kind === "no_check_in") return c.json(errorBody("out_of_order", requestId), 409);
    if (readiness.kind === "too_early") return c.json(errorBody("too_early_to_close", requestId), 425);

    // The close lands first, so a job started, superseded or moved opens no case.
    const landing = await land(c, job, "outcome", { outcome: "no_show" });
    if (!landing.ok) return c.json(errorBody(landing.code, requestId, landing.fields), 409);
    const caseId = await openNoShowCase(c.env.DB, {
      appointmentId: job.id,
      checkIn: readiness.checkIn,
      waitEndsAt: readiness.waitEndsAt,
      now,
    });
    return c.json(
      {
        closed: true,
        wait_ends_at: readiness.waitEndsAt.toISOString(),
        case_id: caseId,
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
const namedJob = (c: Ctx, id: string): Promise<WorkableJob | null> => workableJob(c.env.DB, id);

/** What a step's handler returns: the event's body, or the fields that were wrong. */
type StepBody = Record<string, unknown> | { invalid: string[] };

/** One in-job step: check it, land it once, and put its FSM write on the queue. */
async function step(c: Ctx, kind: JobEventKind, build: (job: WorkableJob) => StepBody | Promise<StepBody>) {
  const job = await namedJob(c, c.req.param("id") ?? "");
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
  | {
      readonly ok: false;
      readonly code: "superseded" | "out_of_order" | "not_today" | "already_started";
      readonly fields?: string[];
    };

/**
 * The client's WhatsApp that his technician has arrived, the no-show's evidence (ADR 0047), once per visit. One
 * the queue drops, the sweeper sends; the check-in has landed either way.
 */
async function tellOfArrival(c: Ctx, input: { personId: string; appointmentId: string; arrivedAt: Date }) {
  const messageId = await arrivalNotice(c.env.DB, { ...input, now: c.var.deps.now() });
  if (messageId === null) return;
  try {
    await c.env.MESSAGE_QUEUE.send({ message_id: messageId, request_id: c.var.requestId } satisfies MessagingMessage);
  } catch (error) {
    c.var.log.warn("message_enqueue_failed", { outbound_message_id: messageId, error });
  }
}

/**
 * A landed event's FSM write. One the queue refuses stays pending, and the sweeper sends it on once its grace has
 * passed (src/scheduled/sweeper.ts); the event has landed either way.
 */
async function queueFsmWrite(c: Ctx, jobEventId: string): Promise<void> {
  try {
    await c.env.FSM_QUEUE.send({ job_event_id: jobEventId, request_id: c.var.requestId } satisfies FsmSyncMessage);
  } catch (error) {
    c.var.log.warn("fsm_enqueue_failed", { job_event_id: jobEventId, error });
  }
}

/**
 * Records one event and queues its FSM write. Its time is the phone's, within
 * bounds: the check-in passes its own, and any other write's comes from its
 * event ID.
 */
async function land(
  c: Ctx,
  job: WorkableJob,
  kind: JobEventKind,
  body: Record<string, unknown>,
  phoneTime?: Date,
): Promise<Landed> {
  const { technicianId, deviceRowId } = technicianOf(c);
  const now = c.var.deps.now();
  const eventId = c.req.header(EVENT_ID_HEADER) ?? "";
  const heldStart = c.req.header(JOB_STARTS_AT_HEADER);

  const landing: Landing = await landJobEvent(c.env.DB, {
    job,
    technicianId,
    deviceRowId,
    eventId,
    kind,
    body,
    occurredAt: phoneTime ?? boundedPhoneTime(timeOfUuidV7(eventId), { visitStart: job.windowStart, receivedAt: now }),
    expectedStart: heldStart === undefined ? null : new Date(heldStart),
    now,
  });
  if (landing.kind === "superseded") {
    c.var.log.info("job_event_superseded", { appointment_id: job.id, kind, changed: landing.changed });
    return { ok: false, code: "superseded", fields: [...landing.changed] };
  }
  if (landing.kind === "out_of_order") return { ok: false, code: "out_of_order", fields: [landing.needs] };
  if (landing.kind === "not_today" || landing.kind === "already_started") return { ok: false, code: landing.kind };

  // A replay landed nothing new, so nothing new goes to FSM either.
  if (!landing.replayed) await queueFsmWrite(c, landing.event.id);
  const { noShowWaitMin } = await opsInputs(c);
  return {
    ok: true,
    accepted: {
      event_id: landing.event.eventId,
      replayed: landing.replayed,
      fsm_write_state: landing.event.fsmWriteState,
      progress: await progressOf(c.env.DB, job, noShowWaitMin),
    },
  };
}
