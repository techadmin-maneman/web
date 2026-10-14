// The shapes of the console's booking routes (./visits.ts): a visit's price and service, who is free, how it would
// be paid, the remakes it may make good, and the fortnight's windows for a client.

import { z } from "@hono/zod-openapi";
import { BOOKING_WINDOWS } from "../../config/scheduling.ts";
import { VISIT_TYPES } from "../../config/visit-types.ts";
import { PAYS } from "../../domain/booking/visit-booking.ts";
import { ServiceSchema } from "../schemas/booking.ts";

/** A visit's price, as the client's app gives it; the console's own "Price" is a row of the price book. */
export const PriceSchema = z
  .object({
    amount_ex_gst: z.number().int().openapi({ description: "In paise, before GST." }),
    amount: z.number().int().openapi({ description: "In paise, GST included: what the client pays." }),
    gst_percent: z.number(),
  })
  .strict()
  .openapi("VisitPrice");

export const TechnicianSchema = z.object({ id: z.string(), name: z.string() }).strict().openapi("FreeTechnician");

const ServiceOfferSchema = z
  .object({ tier: z.string(), name: z.string(), minutes: z.number().int(), price: PriceSchema })
  .strict()
  .openapi("ServiceOffer");

export const PaysSchema = z.enum(PAYS).openapi({
  description:
    "How the visit is paid for: nothing at booking (free, or a consultation and fit in one visit, paid by a link " +
    "once fitted), a service-visit credit, or a payment link Razorpay texts the client.",
});

const OwedSchema = z
  .object({
    id: z
      .string()
      .openapi({ description: "The visit left partly done, or the piece to replace: what `covers` names." }),
    why: z.enum(["partial", "recall", "failed"]).openapi({
      description: "Left partly done, a piece of a recalled lot, or a piece that failed with none fitted since.",
    }),
    piece_code: z.union([z.string(), z.null()]),
    since: z.string().openapi({ description: "When it became owed: the visit's start, the recall, or the failure." }),
  })
  .strict()
  .openapi("OwedRemake");

export const OpsAvailabilitySchema = z
  .object({
    kind: z.enum(VISIT_TYPES),
    services: z.array(ServiceOfferSchema).openapi({ description: "The kind's services offered on the first day." }),
    service: ServiceSchema.openapi({
      description:
        "The service the windows are for: the one asked; for a first fit, else the client's recommended one; else the standard one.",
    }),
    recommended: z.union([z.string(), z.null()]).openapi({
      description: "A first fit's hair system as the client's latest profile recommends it, by tier; null for none.",
    }),
    pays: PaysSchema,
    credits: z.number().int().openapi({ description: "The service-visit credits the client has to spend." }),
    owed: z.array(OwedSchema).openapi({
      description:
        "What a visit of this kind may make good for the client, free and with no late fee, oldest first " +
        "(docs/decisions/0192-free-remakes.md).",
    }),
    days: z.array(
      z
        .object({
          date: z.iso.date(),
          windows: z.array(
            z
              .object({
                window: z.enum(BOOKING_WINDOWS),
                start: z.string().openapi({ description: "When the window starts that day, in India's time." }),
                end: z.string(),
                technicians: z.array(TechnicianSchema).openapi({
                  description:
                    "Who in the caller's cities is free for the visit: never the technician who took the client's visit " +
                    "just before or just after it.",
                }),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict()
  .openapi("OpsAvailability");
