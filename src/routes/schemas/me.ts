// The client app's Home (GET /api/me, src/routes/client/me.ts): who the client is, their visits, what Home offers and
// prompts, and what they may book. Kept apart from the route so the route reads as what it does.

import { z } from "@hono/zod-openapi";
import { WINDOW_LABELS } from "../../config/booking.ts";
import { BOOKING_WINDOWS } from "../../config/scheduling.ts";
import { VISIT_TYPES } from "../../config/visit-types.ts";
import { CLIENT_STATES } from "../../domain/visits/client-visits.ts";
import { CreditsSchema } from "./credits.ts";
import { OwedPaymentSchema } from "./payments.ts";
import { ReferralRewardSchema } from "./referral-reward.ts";
import { BookingOfferSchema, WindowHoursSchema } from "./booking.ts";
import { BeingBookedSchema, ConsultedSchema, OneVisitPriceSchema, RemakeSchema, VisitSummarySchema } from "./visits.ts";

export const MeSchema = z
  .object({
    state: z.enum(CLIENT_STATES),
    refers: z.boolean().openapi({
      description: "Whether Refer is open: the client's first consultation, or a fit, has been done (ADR 0218).",
    }),
    name: z.string(),
    first_name: z.string(),
    initials: z
      .string()
      .openapi({ description: "For the profile's button: the first letters of the first and last names." }),
    consultation: z
      .object({
        date: z.iso.date(),
        window: z.enum(BOOKING_WINDOWS).openapi({ description: "The window the client asked for." }),
        hours: WindowHoursSchema,
        window_label: z
          .enum(WINDOW_LABELS)
          .nullable()
          .openapi({
            description:
              "Deprecated: read `window`. The window in the first booked page's words; null for the afternoon, " +
              "which it had no words for.",
          }),
        place: z.string().openapi({
          description: "Where it is: the saved address (locality, city and pincode), else the booking's city.",
        }),
        requested: z.boolean().openapi({
          description:
            "Asked for with no slot held, as while self-serve booking is off or by the site's first form: ops confirm " +
            "the time on WhatsApp.",
        }),
        one_visit: z.union([OneVisitPriceSchema, z.null()]).openapi({
          description:
            "A consultation and fit in one visit asked for on /book: what it costs once fitted, after the code typed " +
            "there. Null for a consultation alone.",
        }),
      })
      .strict()
      .nullable()
      .openapi({
        description:
          "A booking's consultation from the site's form, or its first form's, before any visit of the client's is " +
          "on record. Null once one is, and once its day has passed.",
      }),
    next_visit: z
      .union([VisitSummarySchema, z.null()])
      .openapi({ description: "The next visit that has not happened: a consultation for a lead." }),
    consulted: z.union([ConsultedSchema, z.null()]).openapi({
      description:
        "The latest consultation done, while the client is not yet fitted. Null before one, and once fitted.",
    }),
    being_booked: z.union([BeingBookedSchema, z.null()]).openapi({
      description:
        "The soonest visit paid for, or booked free, that is not booked yet: neither booked nor refunded. It is " +
        "on its way, and becomes a visit once it is booked (ADR 0068).",
    }),
    remake: z.union([RemakeSchema, z.null()]).openapi({
      description: "Null when none; a partly done visit's while another visit is booked, a recall's never.",
    }),
    missed_visit: z
      .union([z.object({ date: z.iso.date(), technician: z.string().nullable() }).strict(), z.null()])
      .openapi({
        description:
          "A visit nobody was home for, while ops are still to decide it and nothing is booked since; null for none.",
      }),
    payment_owed: z.union([OwedPaymentSchema, z.null()]).openapi({
      description:
        "The oldest payment the client owes: a consultation and fit in one visit they were fitted at, paid by the " +
        "link Razorpay texted. Null when nothing is owed.",
    }),
    credits: z
      .union([CreditsSchema, z.null()])
      .openapi({ description: "The credit tile: balance and earliest expiry; null with none left." }),
    prompt: z
      .union([
        z.object({ kind: z.literal("address") }).strict(),
        z
          .object({
            kind: z.literal("next_visit"),
            type: z.enum(["service", "replacement"]).openapi({
              description: "The next service, or the replacement where the piece in wear falls due first.",
            }),
            tier: z
              .string()
              .nullable()
              .openapi({ description: "The service of its kind it offers, as booking.next's (ADR 0085)." }),
            due_on: z.iso.date().openapi({
              description:
                "India's day it fell or falls due: a service's from the last visit and the cadence, a replacement's " +
                "the piece's own. Before `date`, it has passed.",
            }),
            date: z.iso.date().openapi({
              description: "India's day it is offered on: the day it falls due, or tomorrow once that has passed.",
            }),
            window: z
              .union([z.enum(BOOKING_WINDOWS), z.null()])
              .openapi({ description: "The last visit's window, where this kind of visit can start in it." }),
            replacement_bookable: z.boolean().openapi({
              description:
                "A service offered while the piece in wear falls due within how far ahead a visit may be booked, " +
                "and no replacement is booked: the replacement is offered beside it.",
            }),
          })
          .strict(),
        z
          .object({
            kind: z.literal("replacement_due"),
            month: z.string().regex(/^\d{4}-\d{2}$/),
            tier: z
              .string()
              .nullable()
              .openapi({
                description:
                  "The replacement service it offers: the client's last one while that is offered, else the first " +
                  "in the console's order (ADR 0085); null while none is offered.",
              }),
          })
          .strict(),
        z.null(),
      ])
      .openapi({
        description:
          "Home's one prompt, the first that applies, in this order: no address given while something " +
          "is booked; the next service due and not booked; then, once no invoice is ready, the month the piece in " +
          "wear falls due, never the day, and only once that month may be booked. Null when none applies.",
      }),
    invoice: z
      .union([
        z
          .object({
            visit_id: z.uuid(),
            date: z.iso.date().openapi({ description: "India's date of the visit." }),
            type: z.union([z.enum(VISIT_TYPES), z.null()]),
          })
          .strict(),
        z.null(),
      ])
      .openapi({
        description:
          "An invoice issued in the last fortnight, which ops may lengthen or shorten, ready to open: a line beneath " +
          "the prompt, or the only one. Null when none is.",
      }),
    booking: BookingOfferSchema,
    care_hours: z
      .object({
        opens: z.number().int().openapi({ description: "The hour Care open, in India, 0 to 23." }),
        closes: z.number().int().openapi({ description: "The hour Care close." }),
        first_reply: z.number().int().openapi({ description: "Minutes within which Care first reply in hours." }),
      })
      .strict()
      .openapi({ description: "Care's hours and their reply promise, as ops set them (care_hours)." }),
    guarantee_days: z.number().int().openapi({
      description: "Days after a first fit the client may ask for a refit or a refund (guarantee_days; ADR 0256).",
    }),
    answers_within: z
      .object({
        grievance_days: z.number().int().openapi({ description: "Days within which a grievance is answered." }),
        deletion_days: z.number().int().openapi({ description: "Days within which a deletion request is acted on." }),
        invoices_kept_years: z.number().int().openapi({ description: "Years invoices are kept, as the law asks." }),
      })
      .strict()
      .openapi({
        description:
          "What the account's promises say: the first two from the Tasks deadlines ops set, the third the law's.",
      }),
    hair_system: z
      .union([
        z
          .object({
            package: z.string().openapi({ description: "The package's code, which its services share as their tier." }),
            name: z.string().openapi({ description: "The package's name, as clients read it." }),
            fitted_on: z.iso.date().openapi({ description: "India's day the hair system worn now was fitted." }),
            replace_after_months: z.number().int().openapi({ description: "How many months its package's are worn." }),
            due_on: z.iso.date().openapi({ description: "India's day it falls due." }),
            replacement_opens_on: z.iso.date().openapi({
              description:
                "The first day of the month it falls due: the first day its replacement may be booked on (ADR 0253). " +
                "`booking.types` says whether it may be booked now.",
            }),
          })
          .strict(),
        z.null(),
      ])
      .openapi({ description: "The hair system the client wears now; null for none on record." }),
    referral_reward: ReferralRewardSchema.openapi({
      description:
        "What a referral earns now, as ops set it: the Refer tab's promise, for a lead as for a fitted client, and " +
        "the invite's preview say it (docs/decisions/0107-referral-rewards-in-the-console.md).",
    }),
    pending_invite: z
      .union([
        z
          .object({
            referrer_first_name: z.string().nullable().openapi({
              description: "Who sent it, exactly where the invite's own page names them; null where it does not.",
            }),
          })
          .strict(),
        z.null(),
      ])
      .openapi({
        description:
          "The invite a client not yet fitted came with, while its free service visits (referral_reward's " +
          "friend_visits) wait on their first fit. Null once they are fitted, and where they came with none or it " +
          "lapsed.",
      }),
  })
  .strict()
  .openapi("Me");
