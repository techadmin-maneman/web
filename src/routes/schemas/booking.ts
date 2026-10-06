// A price, a service, a hold and a booking as the client's app reads them (src/routes/client/booking.ts), which its
// other routes, the console's and the site's published prices answer in too.

import { z } from "@hono/zod-openapi";
import { BOOKING_WINDOWS } from "../../config/scheduling.ts";
import { VISIT_TYPES } from "../../config/visit-types.ts";
import { CHARGES } from "../../policy/moving-a-visit.ts";
import { PRICE_TIER } from "../../policy/services.ts";

export const PriceSchema = z
  .object({
    amount_ex_gst: z.number().int().openapi({ description: "In paise, before GST: the main figure." }),
    amount: z.number().int().openapi({ description: "In paise, GST included: what the client pays." }),
    gst_percent: z.number(),
  })
  .strict()
  .openapi("Price");
const TechnicianSchema = z.object({ name: z.string(), initials: z.string() }).strict();
/** A service as a booking names it: its code within its kind, its name, and how long it takes. */
export const ServiceSchema = z
  .object({
    tier: z.string().openapi({ description: "Its code within its kind, which never changes." }),
    name: z.string(),
    minutes: z.number().int().openapi({ description: "How long the visit is booked for." }),
  })
  .strict()
  .openapi("VisitService");
/** A service's code within its kind, as the price book prices it (PRICE_TIER, src/policy/services.ts). */
export const Tier = z
  .string()
  .regex(PRICE_TIER)
  .optional()
  .openapi({
    description:
      "The service's code within its kind; left out, the kind's standard service while offered. A first fit has " +
      "none: it names the hair system.",
  });
export const HoldSchema = z
  .object({
    id: z.uuid(),
    type: z.enum(VISIT_TYPES),
    service: ServiceSchema.openapi({ description: "What it is for, with the length it is held and booked for." }),
    date: z.iso.date(),
    window: z.enum(BOOKING_WINDOWS),
    starts_at: z.iso.datetime(),
    ends_at: z.iso.datetime(),
    technician: TechnicianSchema,
    price: PriceSchema,
    late_fee: z.union([PriceSchema, z.null()]).openapi({
      description: "The late fee moving it inside the notice costs, where it is sold to charge one; else null.",
    }),
    free_until: z.iso.datetime().openapi({ description: "Until then, moving or cancelling is free." }),
    change_notice_hours: z
      .number()
      .int()
      .openapi({
        description:
          "The notice it is sold under: how many hours before its window moving or cancelling stops being free, as " +
          "ops set it when the hold was made (24 to begin with).",
      }),
    late_change_charge: z.enum(CHARGES).openapi({
      description:
        "What moving or cancelling it inside the notice costs, as it is sold: nothing, its late fee (late_fee), or " +
        "the visit itself, whose payment is kept or whose credit is spent (visit).",
    }),
    expires_at: z.iso.datetime(),
    pay_by: z.iso.datetime().openapi({
      description:
        "The last moment a payment counts as made in time: expires_at and the grace after it. Checkout closes then.",
    }),
    state: z.enum(["held", "expired", "booked", "released"]),
    paid: z.boolean().openapi({ description: "Razorpay has confirmed the payment; the visit is being booked." }),
    visit_id: z.union([z.uuid(), z.null()]).openapi({ description: "The visit it became, once booked." }),
    moves_visit_id: z
      .union([z.uuid(), z.null()])
      .openapi({ description: "The visit this hold moves; null for a new booking." }),
    credit: z
      .union([
        z
          .object({ remaining: z.number().int().openapi({ description: "Credits left once this one is used." }) })
          .strict(),
        z.null(),
      ])
      .openapi({ description: "A service-visit credit covers it, so payment is skipped." }),
    discount: z
      .union([
        z
          .object({
            code: z.string(),
            amount_ex_gst: z.union([z.number().int(), z.null()]).openapi({
              description: "In paise: what the code takes off before GST; null until the price it comes off is known.",
            }),
            list_price: z
              .union([PriceSchema, z.null()])
              .openapi({ description: "The price before the code; price is what is left, with GST on it." }),
          })
          .strict(),
        z.null(),
      ])
      .openapi({ description: "The discount code entered on it (docs/decisions/0108-discount-codes.md); else null." }),
  })
  .strict()
  .openapi("Hold");

export const BookingSchema = z
  .object({
    hold_id: z.uuid(),
    checkout: z
      .union([
        z
          .object({
            key_id: z.string(),
            order_id: z.string(),
            amount: z.number().int(),
            currency: z.literal("INR"),
            name: z.string(),
            description: z.string(),
            prefill: z.object({ name: z.string(), contact: z.string() }).strict(),
          })
          .strict(),
        z.null(),
      ])
      .openapi({ description: "What Razorpay Checkout opens with; null for a free visit, booked without paying." }),
  })
  .strict()
  .openapi("Booking");
