// The technician API's schemas (./jobs.ts): what each call takes and answers.

import { z } from "@hono/zod-openapi";
import { BOOKING_WINDOWS } from "../../config/scheduling.ts";
import { VISIT_TYPES } from "../../config/visit-types.ts";
import { ANGLES, PHASES } from "../../domain/visit-photos.ts";
import { CARD_STEPS } from "../../policy/in-job-steps.ts";
import { PAYMENT_BADGES } from "../../policy/job-visibility.ts";
import { BasedOnSchema, FitSpecSchema, HairProfileSchema, HistorySchema } from "../schemas/hair-profile.ts";
import { PieceSchema } from "./pieces.ts";

export const jobId = z.object({ id: z.uuid() });

/** The header every write carries, so a replay lands once. */
export const EVENT_ID_HEADER = "X-Client-Event-Id";
/** The job's start as the phone holds it, which a write may carry. */
export const JOB_STARTS_AT_HEADER = "X-Job-Starts-At";
export const EventIdSchema = z
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

const ServiceSchema = z
  .object({
    tier: z.string().openapi({ description: "Its code, which the hair profile names a first fit's product by." }),
    name: z.string().openapi({ description: "Its name in the console." }),
  })
  .strict()
  .openapi("TechnicianService");

const JobSummarySchema = z
  .object({
    id: z.uuid(),
    day: z.enum(["past", "today", "tomorrow", "later"]),
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
    service: z.union([ServiceSchema, z.null()]).openapi({
      description:
        "The service the visit was sold as, where it names more than the visit's kind: a first fit's hair system, " +
        "say. Null for a kind's standard service, and on a one visit until the client chooses.",
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
    minutes: z
      .union([z.number().int(), z.null()])
      .openapi({ description: "How long the visit is booked for, in minutes. Null for an unknown type." }),
    unlocked: z.boolean(),
    unlocks_at: z.iso.datetime(),
    client_name: z.union([z.string(), z.null()]).openapi({
      description: "The client's name, from the day before the visit as the card's client is; null until then.",
    }),
    progress: z
      .object({
        started_at: z.union([z.iso.datetime(), z.null()]),
        outcome: z.union([z.string(), z.null()]),
      })
      .strict()
      .openapi("TechnicianJobState", {
        description:
          "When the job began and how it closed, from the steps that reached us, whatever the visit's status says yet.",
      }),
  })
  .strict()
  .openapi("TechnicianJob");

export const JobsSchema = z
  .object({ date: z.iso.date(), jobs: z.array(JobSummarySchema) })
  .strict()
  .openapi("TechnicianJobs", { description: "Jobs further out carry only time, type and sector." });

const ProgressSchema = z
  .object({
    checked_in_at: z.union([z.iso.datetime(), z.null()]),
    wait_ends_at: z.union([z.iso.datetime(), z.null()]).openapi({
      description:
        "When the job may close as a no-show, from the check-in we hold, or from the booked start for one before it; " +
        "null before one landed.",
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

export const JobDetailSchema = JobSummarySchema.extend({
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
  checkin_from: z.iso.datetime().openapi({
    description:
      "The earliest moment the job takes a check-in or a start: the booked start less the minutes ops allow.",
  }),
  checkin_radius_m: z.number().int().openapi({
    description: "How near the address a check-in must be, in metres, as ops set it.",
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
  reminder: z.union([z.object({ delivered_at: z.union([z.iso.datetime(), z.null()]) }).strict(), z.null()]).openapi({
    description:
      "The day-before or arrival WhatsApp that went to the client, and when it was delivered; null when none went, as when one was skipped or failed.",
  }),
  steps: z.array(z.enum(CARD_STEPS)).openapi({
    description: "The steps this visit type runs, in order; a consultation's and a one visit's take the profile.",
  }),
  checklist: z
    .array(JobSheetItemSchema)
    .openapi({ description: "This kind of visit's checklist, as ops set it in the console, in its order." }),
  checklist_if_declined: z.array(JobSheetItemSchema).openapi({
    description:
      "On a one visit, the checklist it runs once the client decides against the fit: the consultation's alone. " +
      "Empty on any other visit.",
  }),
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
  client_choice: z
    .union([
      z.object({ declined: z.literal(true) }).strict(),
      z
        .object({ product: z.string().openapi({ description: "The product's tier, from the card's products." }) })
        .strict(),
      z.null(),
    ])
    .openapi({
      description:
        "On a one visit, what the client decided as its piece step recorded it: the product they chose, or that " +
        "they decided against the fit. Null until the piece step lands, and on any other visit.",
    }),
  profile: z.union([HairProfileSchema, z.null()]).openapi({
    description:
      "The client's hair profile as it stands, for the piece card and for the profile step to start from. Null until " +
      "the day before the visit, or before one is recorded.",
  }),
}).openapi("TechnicianJobDetail");

export const AcceptedSchema = z
  .object({
    event_id: z.string(),
    replayed: z.boolean().openapi({ description: "True when this write had already landed." }),
    fsm_write_state: z.enum(["pending", "written", "rejected"]).openapi({
      description: 'Kept for phones that read it: "written" once the step has landed, which it has.',
    }),
    progress: ProgressSchema,
  })
  .strict()
  .openapi("TechnicianWriteAccepted");

export const CheckInRequestSchema = z
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

export const CheckInSchema = z
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

export const UploadUrlRequestSchema = z
  .object({ phase: z.enum(PHASES), angle: z.enum(ANGLES) })
  .strict()
  .openapi("TechnicianPhotoUrlRequest");

export const UploadUrlSchema = z
  .object({
    upload_url: z.string().openapi({ description: "A path on this host. PUT the photograph there." }),
    small_upload_url: z.string().openapi({
      description: "A path on this host. PUT the photograph's small copy there, once the photograph is in.",
    }),
    expires_at: z.iso.datetime(),
  })
  .strict()
  .openapi("TechnicianPhotoUrl");

export const PhotosRequestSchema = z
  .object({ phase: z.enum(PHASES) })
  .strict()
  .openapi("TechnicianPhotosRequest");

export const NoShowSchema = z
  .object({
    closed: z.boolean(),
    wait_ends_at: z.iso.datetime(),
    case_id: z.union([z.uuid(), z.null()]),
    accepted: z.union([AcceptedSchema, z.null()]),
  })
  .strict()
  .openapi("NoShowClose");

export const ProfileRequestSchema = z
  .object({ fit: FitSpecSchema, history: z.union([HistorySchema, z.null()]), based_on: BasedOnSchema })
  .strict()
  .openapi("TechnicianProfileRequest", {
    description:
      "The client's whole profile as it stands now: the card's latest, changed where the technician changed it. " +
      "Each is a new version.",
  });

export const ProfileRecordedSchema = z
  .object({
    event_id: z.string(),
    replayed: z.boolean().openapi({ description: "True when this write had already landed." }),
    progress: ProgressSchema,
  })
  .strict()
  .openapi("TechnicianProfileRecorded", { description: "Kept in our records alone." });

/** A step that landed, or had landed before. */
