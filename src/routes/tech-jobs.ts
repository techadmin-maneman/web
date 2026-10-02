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
//   PUT  /api/tech/photos/:token/small           its small copy, for the client app's rows
//   POST /api/tech/jobs/:id/photos               the set is complete: attach it to FSM, where FSM holds the record
//   POST /api/tech/jobs/:id/checklist            the service checklist
//   POST /api/tech/jobs/:id/consumables          what was used, with quantities
//   POST /api/tech/jobs/:id/piece                the piece fitted, or the one that failed; on a one visit, the
//                                                product chosen with it, or that the client decided against it
//   POST /api/tech/jobs/:id/profile              the client's hair profile: the fit spec and their history
//   POST /api/tech/jobs/:id/outcome              done, or partial with a reason; a one visit closed as done
//                                                sends the client its payment link
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
//
// A consultation and fit in one visit runs the first fit's steps, its checklist
// the consultation's and the fit's; the client chooses the product with the
// technician, or decides against it, at the piece step, and closing it as done
// makes it the product's visit, whose payment link Razorpay then texts to the
// client, or a consultation (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
//
// A consultation and a one visit also take the client's hair profile, just
// before the after photographs. It is not a job event: it lands in its own
// table, never reaches FSM, and the job's order leaves it out, so it needs only
// the start (docs/decisions/0106-a-clients-hair-profile.md).

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../http/context.ts";
import { CONSUMABLE_BOUNDS } from "../config/consumables.ts";
import { fieldRecord, recordOfVisit } from "../config/field-record.ts";
import { isPieceCode } from "../config/pieces.ts";
import { BOOKING_WINDOWS } from "../config/scheduling.ts";
import { VISIT_TYPES, type VisitType } from "../config/visit-types.ts";
import { latestArrival, recordArrival } from "../domain/check-ins.ts";
import { allConsumables, offeredForJob, serviceOfJob } from "../domain/consumables.ts";
import { profileLanded, recordAtVisit } from "../domain/hair-profiles.ts";
import {
  kindsLanded,
  landJobEvent,
  wasTheirs,
  whatChanged,
  type Landing,
  type MovedTo,
  type StepRecord,
  type Superseding,
} from "../domain/job-events.ts";
import { jobRecordOf, type LandingStep } from "../domain/job-record.ts";
import { pieceLabelTaken, pieceStepOf, type PieceField } from "../domain/pieces.ts";
import { checklistOf, jobSheet, knownCodes } from "../domain/job-sheet-settings.ts";
import { recordJobUse } from "../domain/job-use.ts";
import { tellOfLowStock } from "../domain/stock.ts";
import { roomFor } from "../domain/storage-meter.ts";
import { noShowReadiness, openNoShowCase } from "../domain/no-shows.ts";
import { closeOneVisit } from "../domain/one-visit.ts";
import { offeredProducts } from "../domain/services.ts";
import { jobDetail, jobsOn, lastVisitPhoto, progressOf, workableJob, type WorkableJob } from "../domain/tech-jobs.ts";
import {
  anglesHeld,
  MAX_PHOTO_BYTES,
  slotOfLink,
  storeTechnicianPhoto,
  storeThumbnail,
  uploadLink,
  type PhotoSlot,
} from "../domain/tech-photos.ts";
import { ANGLES, PHASES } from "../domain/visit-photos.ts";
import { errorBody, errorResponse, type ErrorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { requireTechnicianSession, technicianOf } from "../http/technician-session.ts";
import { indiaDate } from "../lib/india-time.ts";
import { timeOfUuidV7 } from "../lib/uuidv7.ts";
import { CARD_STEPS, stepsFor, type JobEventKind } from "../policy/in-job-steps.ts";
import { takesProfile } from "../policy/hair-profile.ts";
import { PAYMENT_BADGES } from "../policy/job-visibility.ts";
import { noShowWaitEnds } from "../policy/no-show.ts";
import { boundedPhoneTime } from "../policy/phone-clock.ts";
import { opsInputs } from "../http/ops-inputs.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";
import type { MessagingMessage } from "../queues/messaging.ts";
import { arrivalNotice } from "../domain/visit-messages.ts";
import { BasedOnSchema, FitSpecSchema, HairProfileSchema, HistorySchema } from "./hair-profile-schemas.ts";
import { PieceSchema } from "./tech-pieces.ts";

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
    one_visit: z.boolean().openapi({
      description:
        "A consultation and fit in one visit: the first fit's steps, with the client's choice of product, or none, " +
        "at the piece step.",
    }),
    product: z.union([z.string(), z.null()]).openapi({
      description:
        "On a first fit, the hair system the client was sold, by its name in the console. Null on any other visit, " +
        "on a one visit until the client chooses, and on a first fit that names none.",
    }),
    sector: z.union([z.string(), z.null()]).openapi({
      description:
        "The area, never the street: the one the visit's pincode is in, from the service area; else the address's " +
        "locality, or the city.",
    }),
    status: z.enum(["scheduled", "dispatched", "in_progress", "completed", "cancelled", "terminated", "other"]),
    badge: z.enum(PAYMENT_BADGES).openapi({
      description:
        "Free for a visit the price book charges nothing for; at_visit for a one visit, paid for once the client is " +
        "fitted. No response to a technician carries an amount.",
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
    steps_done: z.array(z.enum(CARD_STEPS)).openapi({
      description: "The steps that have reached us, in that order: the job's events, and the profile once recorded.",
    }),
    outcome: z.union([z.string(), z.null()]),
  })
  .strict()
  .openapi("TechnicianJobProgress");

/** One item of the job sheet: the code the app sends back, and the words the technician reads. */
const JobSheetItemSchema = z.object({ id: z.string(), label: z.string() }).strict().openapi("JobSheetItem");

const OfferedSchema = z
  .object({
    code: z.string().openapi({ description: "What the consumables step sends back." }),
    name: z.string(),
    unit: z.string().openapi({ description: "What one is counted in: strip, ml, sachet." }),
    expected: z.number().int().openapi({
      description: "How many this job's service is expected to use; 0 for one it lists no use for.",
    }),
  })
  .strict()
  .openapi("TechnicianConsumable");

const ProductSchema = z
  .object({
    tier: z.string().openapi({ description: "What the piece step sends back as product." }),
    name: z.string(),
  })
  .strict()
  .openapi("TechnicianProduct");

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
  steps: z.array(z.enum(CARD_STEPS)).openapi({
    description: "The steps this visit type runs, in order; a consultation's and a one visit's take the profile.",
  }),
  checklist: z
    .array(JobSheetItemSchema)
    .openapi({ description: "This kind of visit's checklist, as ops set it in the console, in its order." }),
  partial_reasons: z
    .array(JobSheetItemSchema)
    .openapi({ description: "The reasons a job may be left partly done, as ops set them, in their order." }),
  consumables: z.array(OfferedSchema).openapi({
    description:
      "Every consumable the technician may record, those this job's service is expected to use first, " +
      "each with the count its stepper starts at.",
  }),
  products: z.array(ProductSchema).openapi({
    description:
      "On a one visit and a consultation, the products by name and never by price: the first fit's services " +
      "offered on the visit's day, in ops' order, which a one visit's client chooses from and the profile names. " +
      "Empty for any other visit.",
  }),
  payment_link: z
    .union([
      z
        .object({
          url: z.union([z.string(), z.null()]).openapi({
            description: "The link Razorpay texted the client, to show them; null until Razorpay has made it.",
          }),
          paid: z.boolean(),
        })
        .strict(),
      z.null(),
    ])
    .openapi({ description: "On a one visit closed as done with the client fitted, its payment link; else null." }),
  discount_code: z
    .union([
      z
        .object({
          code: z.string(),
          given_by: z.enum(["client", "technician", "ops"]).openapi({
            description: "client: as they booked; ops: on the booking in the console; technician: at the visit.",
          }),
        })
        .strict(),
      z.null(),
    ])
    .openapi({
      description:
        "On a one visit, the discount code already on it, so the outcome step asks for none; never what it takes " +
        "off. Null on any other visit, and on a one visit with no code.",
    }),
  profile: z.union([HairProfileSchema, z.null()]).openapi({
    description:
      "The client's hair profile as it stands, for the piece card and for the profile step to start from. Null until " +
      "the day before the visit, or before one is recorded.",
  }),
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
    small_upload_url: z.string().openapi({
      description: "A path on this host. PUT the photograph's small copy there, once the photograph is in.",
    }),
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

const QUANTITY = z.number().int().min(1).max(CONSUMABLE_BOUNDS.maxExpected);

const ConsumablesRequestSchema = z
  .object({
    items: z
      .array(
        z.union([
          z.object({ code: z.string().min(1).max(64), quantity: QUANTITY }).strict(),
          z
            .object({ name: z.string().min(1).max(80), quantity: QUANTITY })
            .strict()
            .openapi({
              description: "A consumable by the name the technician gave it, as a phone queued it before codes.",
            }),
        ]),
      )
      .max(30),
  })
  .strict()
  .openapi("ConsumablesRequest", {
    description:
      "What was used, each by the code the job's card gave it. None used is an empty list. A code the " +
      "catalogue does not hold is refused, fields items.",
  });

const PieceFittedSchema = z
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
    product: z.string().min(1).max(32).optional().openapi({
      description:
        "On a one visit, and only there: the product the client chose, by its tier from the card's products.",
    }),
  })
  .strict()
  .openapi("PieceFitted", {
    description:
      "The piece fitted, with its base and lot, and on a replacement the one that came off. A failure_reason on the piece itself marks it as failed and fits nothing.",
  });

const PieceDeclinedSchema = z
  .object({ declined: z.literal(true) })
  .strict()
  .openapi("PieceDeclined", {
    description:
      "On a one visit, and only there: the client decided against the fit, so nothing was fitted, and closing the " +
      "visit as done makes it a consultation.",
  });

const PieceRequestSchema = z.union([PieceFittedSchema, PieceDeclinedSchema]).openapi("PieceRequest");

const OutcomeRequestSchema = z
  .discriminatedUnion("outcome", [
    z.object({ outcome: z.literal("done") }).strict(),
    z
      .object({
        outcome: z.literal("partial"),
        reason: z.string().min(1).max(64).openapi({
          description: "One of the card's partial_reasons, by its id; one ops have since taken off is still taken.",
        }),
      })
      .strict(),
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

const ProfileRequestSchema = z
  .object({ fit: FitSpecSchema, history: z.union([HistorySchema, z.null()]), based_on: BasedOnSchema })
  .strict()
  .openapi("TechnicianProfileRequest", {
    description:
      "The client's whole profile as it stands now: the card's latest, changed where the technician changed it. " +
      "Each is a new version.",
  });

const ProfileRecordedSchema = z
  .object({
    event_id: z.string(),
    replayed: z.boolean().openapi({ description: "True when this write had already landed." }),
    progress: ProgressSchema,
  })
  .strict()
  .openapi("TechnicianProfileRecorded", { description: "Kept in our records alone: nothing of it goes to FSM." });

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
    404: errorResponse("not_found: no such job, or never this technician's"),
    409: errorResponse(
      "superseded: the job was given to another technician or cancelled while its photographs waited; moved names whom",
    ),
  },
});

const PhotoTakenSchema = z
  .object({
    take: z
      .uuid()
      .openapi({ description: "This upload of the angle's photograph, which its small copy's upload names." }),
  })
  .strict()
  .openapi("TechnicianPhotoTaken");

const uploadRoute = createRoute({
  method: "put",
  path: "/api/tech/photos/{token}",
  summary: "The photograph itself: a JPEG or PNG, at most 2 MB",
  request: { params: z.object({ token: z.string().min(1).max(500) }) },
  responses: {
    200: { description: "Received", ...json(PhotoTakenSchema) },
    401: errorResponse("session_required; device_revoked"),
    404: errorResponse("not_found: the link is wrong or expired"),
    422: errorResponse("photo_invalid_file: not a JPEG or PNG, or over 2 MB"),
    503: errorResponse("busy: R2 holds past the runaway ceiling; the phone keeps the photograph and sends it later"),
  },
});

const smallUploadRoute = createRoute({
  method: "put",
  path: "/api/tech/photos/{token}/small",
  summary: "The photograph's small copy, for the client app's rows: a JPEG of at most 64 KB and 800 px a side",
  request: {
    params: z.object({ token: z.string().min(1).max(500) }),
    query: z.object({ take: z.uuid().openapi({ description: "The take the photograph's upload answered." }) }),
  },
  responses: {
    204: { description: "Received, or held already" },
    401: errorResponse("session_required; device_revoked"),
    404: errorResponse("not_found: the link is wrong or expired"),
    409: errorResponse(
      "upload_missing: that take is not the angle's photograph: not arrived yet, or taken again since",
    ),
    422: errorResponse("photo_invalid_file: not a JPEG, or over 64 KB or 800 px a side"),
    503: errorResponse("busy: R2 holds past the runaway ceiling"),
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
  summary: "The piece: a replacement's, a first fit's and a one visit's step only",
  request: { params: jobId, headers: EventIdSchema, body: { required: true, ...json(PieceRequestSchema) } },
  responses: {
    202: RECORDED,
    ...STEP_REFUSALS,
    409: errorResponse(
      "superseded: FSM moved the job; out_of_order: send the step before this one first; piece_code: a label already " +
        "on record, as another client's piece or this client's from an earlier visit, or a piece that came off that " +
        "is another client's. error.fields names piece_code or old_piece, to correct and send again",
    ),
  },
});

const profileRoute = createRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/profile",
  summary: "The client's hair profile, the fit spec and their history, as a new version",
  request: { params: jobId, headers: EventIdSchema, body: { required: true, ...json(ProfileRequestSchema) } },
  responses: {
    202: {
      description:
        "Recorded; or, for a job with no client of ours, taken and nothing written. One taken from an older version " +
        "than the latest still lands, and ops are told.",
      ...json(ProfileRecordedSchema),
    },
    ...STEP_REFUSALS,
    400: errorResponse("invalid_request: see error.fields; visit, for a visit that takes no profile"),
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
    // The job sheet and the consumables as ops set them, which the phone keeps with the job for the day.
    const sheet = await jobSheet(c.env.DB);
    return c.json(
      {
        ...job,
        checklist: [...checklistOf(sheet, { type, oneVisit: job.one_visit }).items],
        partial_reasons: [...sheet.partialReasons.items],
        consumables: await offeredForJob(c.env.DB, await serviceOfJob(c.env.DB, { id: job.id, type }), job.date),
      },
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
    const inputs = await opsInputs(c);
    const at = boundedPhoneTime(claimed, { visitStart: job.windowStart, receivedAt: now }, inputs.phoneClock);
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
    if (!landing.ok) return c.json(refusalOf(c, landing), 409);
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

  // A job given away or cancelled while its photographs waited on the phone says so, as a refused write does.
  app.openapi(uploadUrlRoute, async (c) => {
    const { technicianId } = technicianOf(c);
    const now = c.var.deps.now();
    const id = c.req.valid("param").id;
    const job = await namedJob(c, id);
    if (job === null || !(await wasTheirs(c.env.DB, job, technicianId))) {
      return c.json(errorBody("not_found", c.var.requestId), 404);
    }
    const superseding = await whatChanged(c.env.DB, job, technicianId, null);
    if (superseding.changed.length > 0) {
      c.var.log.info("upload_link_superseded", { appointment_id: job.id, changed: superseding.changed });
      return c.json(refusalOf(c, superseded(superseding)), 409);
    }
    const { phase, angle } = c.req.valid("json");
    const link = await uploadLink(c.var.config.settings.tryon.linkSigningKey, { appointmentId: id, phase, angle }, now);
    return c.json(
      { upload_url: link.url, small_upload_url: link.smallUrl, expires_at: link.expiresAt.toISOString() },
      201,
    );
  });

  app.openapi(uploadRoute, async (c) => {
    const { deps, requestId } = c.var;
    const now = deps.now();
    const slot = await uploadSlot(c, c.req.valid("param").token);
    if (slot === null) return c.json(errorBody("not_found", requestId), 404);

    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_PHOTO_BYTES) {
      return c.json(errorBody("photo_invalid_file", requestId), 422);
    }
    if (!(await roomFor(c.env.DB, deps.alertOnce, bytes.byteLength))) {
      return c.json(errorBody("busy", requestId), 503);
    }
    const stored = await storeTechnicianPhoto(c.env.DB, c.env.CLIENT_PHOTOS, slot, bytes, now, now);
    if (stored.kind === "not_an_image") return c.json(errorBody("photo_invalid_file", requestId), 422);
    c.var.log.info("technician_photo_stored", { appointment_id: slot.appointmentId, phase: slot.phase });
    return c.json({ take: stored.take }, 200);
  });

  app.openapi(smallUploadRoute, async (c) => {
    const { deps, requestId } = c.var;
    const slot = await uploadSlot(c, c.req.valid("param").token);
    if (slot === null) return c.json(errorBody("not_found", requestId), 404);

    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!(await roomFor(c.env.DB, deps.alertOnce, bytes.byteLength))) {
      return c.json(errorBody("busy", requestId), 503);
    }
    const stored = await storeThumbnail(c.env.DB, c.env.CLIENT_PHOTOS, slot, c.req.valid("query").take, bytes);
    if (stored === "not_a_thumbnail") return c.json(errorBody("photo_invalid_file", requestId), 422);
    if (stored === "no_photograph") return c.json(errorBody("upload_missing", requestId), 409);
    return c.body(null, 204);
  });

  app.openapi(photosRoute, async (c) => {
    const phase = c.req.valid("json").phase;
    return step(c, phase === "before" ? "before_photos" : "after_photos", async (job) => ({
      phase,
      angles: await anglesHeld(c.env.DB, job.id, phase),
    }));
  });

  // An item ops have taken off since the phone kept the job is still one it may send.
  app.openapi(checklistRoute, (c) => {
    const { done } = c.req.valid("json");
    return step(c, "checklist", async (job) => {
      const list = checklistOf(await jobSheet(c.env.DB), { type: job.type, oneVisit: job.oneVisit !== null });
      const known = knownCodes(list);
      const unknown = done.filter((item) => !known.has(item));
      return unknown.length > 0 ? { invalid: ["done"] } : { done };
    });
  });

  // By code, or by name from a phone that queued the step before codes. A retired consumable is still taken:
  // it was used. What was used comes out of the technician's kit as the step lands, once however often it does.
  app.openapi(consumablesRoute, (c) => {
    const { items } = c.req.valid("json");
    return step(
      c,
      "consumables",
      async () => {
        const codes = new Set((await allConsumables(c.env.DB)).map((consumable) => consumable.code));
        return items.some((item) => "code" in item && !codes.has(item.code)) ? { invalid: ["items"] } : { items };
      },
      async (job) => {
        const { technicianId } = technicianOf(c);
        const { deps } = c.var;
        const used = await recordJobUse(c.env.DB, { job, technicianId, now: deps.now() });
        await tellOfLowStock(c.env.DB, deps, {
          touched: [technicianId],
          lowered: used.lowered ? [technicianId] : [],
        });
      },
    );
  });

  app.openapi(pieceRoute, (c) => {
    const body = c.req.valid("json");
    return step(c, "piece", async (job) => {
      const built = await pieceBody(c, job, body);
      if ("invalid" in built) return built;
      const taken = await pieceLabelTaken(c.env.DB, job, pieceStepOf(built));
      return taken === null ? built : { labelTaken: taken };
    });
  });

  // A new version of the client's profile, once however often the phone sends it. Like a step it is refused for a
  // job that changed under the phone, before the start, and on a visit that takes none; unlike one it is no job event,
  // and goes to no queue. A job with no client of ours has no profile step on its card; a write for one is answered
  // 202 and writes nothing, so the phone's queue for the job still sends its after photographs and its outcome.
  app.openapi(profileRoute, async (c) => {
    const { technicianId } = technicianOf(c);
    const { requestId, deps } = c.var;
    const job = await namedJob(c, c.req.valid("param").id);
    if (job === null) return c.json(errorBody("not_found", requestId), 404);
    const headers = c.req.valid("header");
    const eventId = headers["x-client-event-id"];
    const { personId } = job;
    if (personId === null) {
      c.var.log.info("profile_without_client", { appointment_id: job.id });
      return c.json(await profileRecorded(c, job, eventId, false), 202);
    }
    if (await profileLanded(c.env.DB, job.id, eventId)) {
      return c.json(await profileRecorded(c, job, eventId, true), 202);
    }

    const heldStart = headers["x-job-starts-at"];
    const superseding = await whatChanged(
      c.env.DB,
      job,
      technicianId,
      heldStart === undefined ? null : new Date(heldStart),
    );
    if (superseding.changed.length > 0) {
      c.var.log.info("profile_superseded", { appointment_id: job.id, changed: superseding.changed });
      return c.json(refusalOf(c, superseded(superseding)), 409);
    }
    if (!(await kindsLanded(c.env.DB, job.id)).has("start")) {
      return c.json(errorBody("out_of_order", requestId, ["start"]), 409);
    }
    if (!takesProfile(job.type, job.oneVisit !== null)) {
      return c.json(errorBody("invalid_request", requestId, ["visit"]), 400);
    }

    const { fit, history, based_on } = c.req.valid("json");
    const written = await recordAtVisit(c.env.DB, {
      personId,
      appointmentId: job.id,
      technicianId,
      eventId,
      fit,
      history,
      basedOn: based_on,
      now: deps.now(),
    });
    if (written.kind === "invalid") return c.json(errorBody("invalid_request", requestId, written.fields), 400);
    if (written.fromOlder) await tellOfOlderBase(c, personId, written.versionId);
    return c.json(await profileRecorded(c, job, eventId, written.replayed), 202);
  });

  // The reasons ops set; one they have taken off since the phone kept the job is still taken. A one visit closed as
  // done becomes a consultation or the product's visit, and asks Razorpay for its payment link once, however often
  // it lands: the close lands whatever Razorpay answers, and the cron asks again for a link it could not make.
  app.openapi(outcomeRoute, (c) => {
    const body = c.req.valid("json");
    return step(
      c,
      "outcome",
      async () => {
        if (body.outcome === "done") return { outcome: "done" };
        const known = knownCodes((await jobSheet(c.env.DB)).partialReasons);
        return known.has(body.reason) ? { outcome: "partial", reason: body.reason } : { invalid: ["reason"] };
      },
      async (job) => {
        if (job.oneVisit === null || body.outcome !== "done") return;
        const { deps, log } = c.var;
        await closeOneVisit(c.env.DB, { ...deps, log }, job, deps.now());
      },
    );
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
    if (!landing.ok) return c.json(refusalOf(c, landing), 409);
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

/** The slot an upload link names, while its job is still this technician's; null for any other link. */
async function uploadSlot(c: Ctx, token: string): Promise<PhotoSlot | null> {
  const slot = await slotOfLink(c.var.config.settings.tryon.linkSigningKey, token, c.var.deps.now());
  if (slot === null) return null;
  const job = await workableJob(c.env.DB, slot.appointmentId);
  return job?.technicianId === technicianOf(c).technicianId ? slot : null;
}

/**
 * The job a write names. Not narrowed to this technician: a job that moved to
 * someone else is answered `superseded`, with what changed, so the phone can
 * tell him, rather than "not found".
 */
const namedJob = (c: Ctx, id: string): Promise<WorkableJob | null> => workableJob(c.env.DB, id);

/**
 * What a step's handler returns: the event's body, the fields that were wrong, or the piece label already on record,
 * by its field.
 */
type StepBody = Record<string, unknown> | { invalid: string[] } | { labelTaken: PieceField };

/**
 * One in-job step: check it, land it once, and record it: in FSM by its queue, or in our own database with the event.
 * What a step keeps of its own, `landed` does once it has landed, first time
 * or replayed, and must do the same however often it is called.
 */
async function step(
  c: Ctx,
  kind: JobEventKind,
  build: (job: WorkableJob) => StepBody | Promise<StepBody>,
  landed?: (job: WorkableJob) => Promise<void>,
) {
  const job = await namedJob(c, c.req.param("id") ?? "");
  if (job === null) return c.json(errorBody("not_found", c.var.requestId), 404);
  const built = await build(job);
  if ("invalid" in built && Array.isArray(built.invalid)) {
    return c.json(errorBody("invalid_request", c.var.requestId, built.invalid), 400);
  }
  if ("labelTaken" in built && typeof built.labelTaken === "string") {
    return c.json(errorBody("piece_code", c.var.requestId, [built.labelTaken]), 409);
  }
  const landing = await land(c, job, kind, built);
  if (!landing.ok) return c.json(refusalOf(c, landing), 409);
  if (landed !== undefined) await landed(job);
  return c.json(landing.accepted, 202);
}

type PieceBody = z.infer<typeof PieceRequestSchema>;

/** The piece step's body for this job: a one visit's choice, or a piece fitted or failed where the job takes one. */
async function pieceBody(c: Ctx, job: WorkableJob, body: PieceBody): Promise<StepBody> {
  if (job.oneVisit !== null) return oneVisitPiece(c, job, body);
  if ("declined" in body || body.product !== undefined) return { invalid: ["product"] };
  if (!(stepsFor(job.type) as string[]).includes("piece")) return { invalid: ["piece_code"] };
  return fittedPiece(body);
}

/** A piece fitted, or the one that failed, as any job's piece step records it. */
function fittedPiece(body: z.infer<typeof PieceFittedSchema>): StepBody {
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
}

/**
 * A one visit's piece step: the client decided against the fit, or chose one of the products offered on the visit's
 * day and was fitted with a new piece from the technician's kit, so nothing came off and nothing failed.
 */
async function oneVisitPiece(c: Ctx, job: WorkableJob, body: PieceBody): Promise<StepBody> {
  if ("declined" in body) return { declined: true };
  if (body.product === undefined) return { invalid: ["product"] };
  if ((body.old_piece ?? null) !== null || (body.failure_reason ?? null) !== null) {
    return { invalid: ["old_piece", "failure_reason"] };
  }
  const offered = await offeredProducts(c.env.DB, indiaDate(job.windowStart));
  if (!offered.some((service) => service.tier === body.product)) return { invalid: ["product"] };
  const fitted = fittedPiece(body);
  return "invalid" in fitted ? fitted : { ...fitted, product: body.product };
}

/**
 * A profile the phone took from an older version than the latest, which it has now replaced: ops are told, by the
 * client's ID and the version's, to compare the two. Never a word of the profile.
 */
async function tellOfOlderBase(c: Ctx, personId: string, versionId: string): Promise<void> {
  await c.var.deps.alertOnce({
    key: `hair_profile_from_older:${versionId}`,
    message:
      `A technician's hair profile for client ${personId} (version ${versionId}) was taken from an older version ` +
      "than the latest, and is now the latest. Compare it with the version before it, and correct it if need be.",
    link: `/clients/${personId}/pieces`,
  });
}

/** The profile step's answer: the event, whether it had landed before, and where the job stands. */
async function profileRecorded(
  c: Ctx,
  job: WorkableJob,
  eventId: string,
  replayed: boolean,
): Promise<z.infer<typeof ProfileRecordedSchema>> {
  const { noShowWaitMin } = await opsInputs(c);
  return { event_id: eventId, replayed, progress: await progressOf(c.env.DB, job, noShowWaitMin) };
}

/** What landing an event came to: the write, or the 409 the route answers. */
type Landed =
  | { readonly ok: true; readonly accepted: z.infer<typeof AcceptedSchema> }
  | {
      readonly ok: false;
      readonly code: "superseded" | "out_of_order" | "not_today" | "already_started";
      readonly fields?: string[];
      /** On a job given to another technician: whom, by first name, and when (docs/open-points.md, item 92). */
      readonly moved?: MovedTo;
    };

/** The 409 of a job that changed under the phone: what changed, and whom it went to where that is to be said. */
function superseded(superseding: Superseding): Extract<Landed, { ok: false }> {
  const fields = [...superseding.changed];
  if (superseding.moved === null) return { ok: false, code: "superseded", fields };
  return { ok: false, code: "superseded", fields, moved: superseding.moved };
}

/** A refused write's 409: its code and fields, and, for a job given to another technician, whom and when. */
function refusalOf(c: Ctx, refused: Extract<Landed, { ok: false }>): ErrorResponse {
  const body = errorBody(refused.code, c.var.requestId, refused.fields);
  if (refused.moved === undefined) return body;
  return { error: { ...body.error, moved: refused.moved } };
}

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

/** Where the step is recorded: by FSM's queue for a visit FSM holds, else in our own database, with the event. */
async function recordedIn(c: Ctx, job: WorkableJob, step: LandingStep): Promise<StepRecord> {
  if (recordOfVisit(fieldRecord(c.var.config.providers), job) === "fsm") return { holder: "fsm" };
  return { holder: "ours", statements: await jobRecordOf(c.env.DB, step) };
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
 * Records one event, and the step's work: on FSM's queue, or in our own database with the event. Its time is the
 * phone's, within bounds: the check-in passes its own, and any other write's comes from its event ID.
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
  const { noShowWaitMin, phoneClock, pieceCycleDays } = await opsInputs(c);
  const bounds = { visitStart: job.windowStart, receivedAt: now };
  const occurredAt = phoneTime ?? boundedPhoneTime(timeOfUuidV7(eventId), bounds, phoneClock);
  const step = { visit: job, kind, body, occurredAt, cycles: pieceCycleDays, now };

  const landing: Landing = await landJobEvent(c.env.DB, {
    job,
    technicianId,
    deviceRowId,
    eventId,
    kind,
    body,
    occurredAt,
    expectedStart: heldStart === undefined ? null : new Date(heldStart),
    now,
    recordedIn: await recordedIn(c, job, step),
  });
  if (landing.kind === "superseded") {
    c.var.log.info("job_event_superseded", { appointment_id: job.id, kind, changed: landing.changed });
    return superseded(landing);
  }
  if (landing.kind === "out_of_order") return { ok: false, code: "out_of_order", fields: [landing.needs] };
  if (landing.kind === "not_today" || landing.kind === "already_started") return { ok: false, code: landing.kind };

  // A replay landed nothing new, so nothing new goes to FSM either; nor does a step our own database recorded.
  if (!landing.replayed && landing.event.fsmWriteState === "pending") await queueFsmWrite(c, landing.event.id);
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
