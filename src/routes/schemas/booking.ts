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

const TIME = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .openapi({ description: "India's clock, HH:MM." });

/** A window's hours on its day, as ops set them (ADR 0102): what every surface says the window is. */
export const WindowHoursSchema = z
  .object({ start: TIME, end: TIME })
  .strict()
  .openapi("WindowHours", { description: "The window's hours on its day, India's clock, as ops set them (ADR 0102)." });
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
    one_visit: z.boolean().openapi({
      description: "A consultation and fit in one visit, whose product is chosen at the visit, not the service named.",
    }),
    service: ServiceSchema.openapi({ description: "What it is for, with the length it is held and booked for." }),
    date: z.iso.date(),
    window: z.enum(BOOKING_WINDOWS),
    hours: WindowHoursSchema,
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

/** What the client may book in the app, and what the booking sheet opens with. */
export const BookingOfferSchema = z
  .object({
    self_serve: z.boolean().openapi({ description: "Booking every kind of visit in the app is on." }),
    self_serve_kinds: z.array(z.enum(VISIT_TYPES)).openapi({
      description:
        "The kinds of visit the client books, moves and cancels in the app; for any other the app opens WhatsApp.",
    }),
    types: z.array(z.enum(VISIT_TYPES)).openapi({ description: "What the client may book now." }),
    services: z
      .array(
        z
          .object({
            type: z.enum(VISIT_TYPES),
            tier: z.string().openapi({ description: "Its code within its kind, which booking it names." }),
            name: z.string(),
            description: z
              .union([z.string(), z.null()])
              .openapi({ description: "The line ops wrote to read under its name; null for none." }),
            minutes: z.number().int().openapi({ description: "How long the visit is booked for." }),
            price: PriceSchema.openapi({ description: "Its price tomorrow, the first day it can be booked." }),
          })
          .strict()
          .openapi("OfferedService"),
      )
      .openapi({
        description:
          "Every service of those kinds offered and priced now, a kind at a time, in the console's order. A " +
          "first fit's are the hair systems ops offer; with none, a first fit cannot be booked yet.",
      }),
    next: z
      .union([
        z
          .object({
            type: z.enum(["first_fit", "service", "replacement"]),
            tier: z
              .string()
              .nullable()
              .openapi({
                description:
                  "The service it is offered as: the one the client's last visit of its kind was, while that is " +
                  "offered, else its kind's first in the console's order (ADR 0085). Null while its kind offers " +
                  "none, as a first fit does before ops offer a hair system: it cannot be booked yet.",
              }),
            due_on: z.iso.date().openapi({
              description:
                "India's day it fell or falls due: a service's from the last visit and the cadence, a " +
                "replacement's the piece's own, a first fit's from the consultation and the lead time.",
            }),
            date: z.iso.date().openapi({
              description: "India's day it is offered on: the day it falls due, or tomorrow once that has passed.",
            }),
            window: z.union([z.enum(BOOKING_WINDOWS), z.null()]),
          })
          .strict(),
        z.null(),
      ])
      .openapi({
        description:
          "What the app offers next, with nothing booked, for the booking sheet to open with: the first fit " +
          "once the consultation is done, from the lead time and in the consultation's window; " +
          "or the next service on its due day, in the last visit's window, or the replacement where the piece " +
          "falls due first, on the earlier of its own due day and the service's (ADR 0086).",
      }),
  })
  .strict();
