// The technician API's day (src/routes/tech/jobs.read.ts): each job on the list, and the list. A job's own card
// builds on it (src/routes/tech/jobs.schemas.ts).

import { z } from "@hono/zod-openapi";
import { BOOKING_WINDOWS } from "../../config/scheduling.ts";
import { VISIT_TYPES } from "../../config/visit-types.ts";
import { APPOINTMENT_STATUSES, STATUS_MEANINGS } from "../../domain/visits/visit-status.ts";
import { PAYMENT_BADGES } from "../../policy/job-visibility.ts";

const ServiceSchema = z
  .object({
    tier: z.string().openapi({ description: "Its code, which the hair profile names a first fit's product by." }),
    name: z.string().openapi({ description: "Its name in the console." }),
  })
  .strict()
  .openapi("TechnicianService");

export const JobSummarySchema = z
  .object({
    id: z.uuid(),
    day: z.enum(["past", "today", "tomorrow", "later"]),
    date: z.iso.date(),
    starts_at: z.iso.datetime(),
    arrives_by: z.iso.datetime().openapi({
      description: "The end of the arrival window the client was promised: the start and the arrival minutes ops set.",
    }),
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
    status: z.enum(APPOINTMENT_STATUSES).openapi({ description: STATUS_MEANINGS }),
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

/** The address as the client saved it. */
export const AddressSchema = z
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
  .openapi({ description: "Null until the day before the visit; the API enforces it, not the screen." });

/** A job on the day's list: its address too, for Navigate, and the next job still to do from it. */
const DayJobSchema = JobSummarySchema.extend({
  address: AddressSchema,
  next: z
    .union([
      z
        .object({
          drive_minutes: z.number().int().openapi({ description: "The drive to it, by our estimate." }),
          finish_by: z.iso.datetime().openapi({
            description:
              "When this job must be done for its wrap-up and that drive to reach the next one by its start.",
          }),
        })
        .strict(),
      z.null(),
    ])
    .openapi({ description: "The day's next job still to do; null for the last, and for a job already closed." }),
}).openapi("TechnicianDayJob");

export const JobsSchema = z
  .object({ date: z.iso.date(), jobs: z.array(DayJobSchema) })
  .strict()
  .openapi("TechnicianJobs", { description: "Jobs further out carry only time, type and sector." });
