// GET /api/me: the client app's Home card (docs/prompts/phase2-backend.md,
// "Read endpoints"). A client is fitted once a first fit or a later visit is
// done (the FSM mirror, docs/decisions/0032-fsm-mirror.md); a lead has a
// consultation, from the mirror or from their booking on the site before FSM
// has it; else nothing is booked. The next visit comes from the mirror, and
// the credit tile, board B1's one prompt and the invoice line beneath it (src/domain/home-prompt.ts).
// What the client may book now is every service offered of each kind open to
// them, for the booking sheet to offer (docs/decisions/0085-services-ops-can-edit.md).
//
// A visit paid for, or booked free, that FSM does not have yet is said to be on
// its way, neither booked nor refunded, while FSM is written or while it waits
// after FSM refused it (docs/decisions/0095-a-booking-fsm-refuses-is-held.md).
//
// With nothing booked, it says what the app offers next, which the booking
// sheet opens pre-filled with: the first fit once the consultation is done, or
// the next service once a visit is (docs/decisions/0086-the-next-visit-is-offered.md),
// each as one of the services ops offer.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../http/context.ts";
import { WINDOW_LABELS, type WindowLabel } from "../config/booking.ts";
import { BOOKING_WINDOWS, type BookingWindow } from "../config/scheduling.ts";
import { VISIT_TYPES } from "../config/visit-types.ts";
import { CLIENT_STATES, clientStateOf, isFitted, nextVisit } from "../domain/client-visits.ts";
import { bookingUnderWay } from "../domain/holds.ts";
import { spendableCredits } from "../domain/credits.ts";
import { homePrompts, promptFacts } from "../domain/home-prompt.ts";
import { nextVisitFacts } from "../domain/next-visit.ts";
import { bookableTypes } from "../domain/scheduling.ts";
import { offeredAmong, servicesOnDay } from "../domain/services.ts";
import { currentAddress, liveContact } from "../domain/profile.ts";
import {
  askedFor,
  latestProposal,
  standingProposal,
  type Asked,
  type ProposedBooking,
} from "../domain/proposed-visits.ts";
import { clientOf, requireClientSession } from "../http/client-session.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { opsInputs } from "../http/ops-inputs.ts";
import { addDays, indiaDate } from "../lib/india-time.ts";
import { firstNameOf, initialsOf } from "../lib/names.ts";
import { PriceSchema } from "./client-booking.ts";
import { creditsBody, CreditsSchema } from "./client-refer.ts";
import { VisitSummarySchema } from "./client-visits.ts";
import { ReferralRewardSchema } from "./referral-reward.ts";

export const MeSchema = z
  .object({
    state: z.enum(CLIENT_STATES),
    name: z.string(),
    first_name: z.string(),
    initials: z
      .string()
      .openapi({ description: "For the profile's button: the first letters of the first and last names." }),
    consultation: z
      .object({
        date: z.iso.date(),
        window: z.enum(BOOKING_WINDOWS).openapi({ description: "The window the client asked for." }),
        window_label: z
          .enum(WINDOW_LABELS)
          .nullable()
          .openapi({
            description:
              "Deprecated: read `window`. The window in the Phase 1 booked page's words; null for the afternoon, " +
              "which Phase 1 had no words for.",
          }),
        place: z.string().openapi({
          description: "Where it is: the saved address (locality, city and pincode), else the booking's city.",
        }),
        requested: z.boolean().openapi({
          description:
            "Asked for with no slot held, as while self-serve booking is off or by a Phase 1 booking: ops confirm " +
            "the time on WhatsApp.",
        }),
        one_visit: z.boolean().openapi({ description: "The consultation and the first fit in one visit." }),
      })
      .strict()
      .nullable()
      .openapi({
        description:
          "A booking's consultation from the site's form, or a Phase 1 booking, before any visit of the client's is " +
          "on record. Null once one is, and once its day has passed.",
      }),
    next_visit: z
      .union([VisitSummarySchema, z.null()])
      .openapi({ description: "The next visit that has not happened, from FSM: a consultation for a lead." }),
    being_booked: z
      .union([
        z
          .object({
            type: z.enum(VISIT_TYPES),
            date: z.iso.date(),
            window: z.enum(BOOKING_WINDOWS),
            paid: z.boolean().openapi({ description: "Paid for in money, rather than free or covered by a credit." }),
            one_visit: z.boolean().openapi({ description: "A consultation and fit in one visit." }),
          })
          .strict(),
        z.null(),
      ])
      .openapi({
        description:
          "The soonest visit paid for, or booked free, that FSM does not have yet: neither booked nor refunded. It " +
          "is on its way, or held after FSM refused it, and becomes a visit once FSM takes it (ADR 0095).",
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
          "Board B1's one prompt, the first that applies, in the owner's order: no address given while something " +
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
    booking: z
      .object({
        self_serve: z.boolean().openapi({ description: "Booking in the app is on; off, the app opens WhatsApp." }),
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
              "once the consultation is done, from the lead time and in the window the site's request asked for; " +
              "or the next service on its due day, in the last visit's window, or the replacement where the piece " +
              "falls due first, on the earlier of its own due day and the service's (ADR 0086).",
          }),
      })
      .strict(),
    referral_reward: ReferralRewardSchema.openapi({
      description:
        "What a referral earns now, as ops set it: the Refer tab's promise, for a lead as for a fitted client, and " +
        "the invite's preview say it (docs/decisions/0107-referral-rewards-in-the-console.md).",
    }),
  })
  .strict()
  .openapi("Me");

/** The words the Phase 1 booked page had for a window. It had none for the afternoon. */
const PHASE1_WORDS: Partial<Record<BookingWindow, WindowLabel>> = { morning: "before noon", evening: "after four" };

type Consultation = NonNullable<z.infer<typeof MeSchema>["consultation"]>;

function consultationOf(proposal: ProposedBooking, asked: Asked, place: string): Consultation {
  return {
    date: proposal.proposed_visit_date,
    window: asked.window,
    window_label: PHASE1_WORDS[asked.window] ?? null,
    place,
    requested: asked.requested,
    one_visit: asked.oneVisit,
  };
}

export const meRoute = createRoute({
  method: "get",
  path: "/api/me",
  summary: "The Home card: who the client is and what is booked",
  responses: {
    200: { description: "The Home card", content: { "application/json": { schema: MeSchema } } },
    401: errorResponse("session_required"),
  },
});

/** The latest booking a form left, and that booking while it stands as the client's consultation. */
interface FormBooking {
  readonly booking: ProposedBooking | null;
  readonly proposal: ProposedBooking | null;
  /** Home's consultation card: the proposal's day, what it asked for, and where. */
  readonly card: Consultation | null;
}

async function formBookingOf(c: Context<AppEnv>, personId: string, today: string): Promise<FormBooking> {
  const db = c.env.DB;
  const booking = await latestProposal(db, personId);
  const proposal = await standingProposal(db, personId, booking, today);
  if (proposal === null) return { booking, proposal, card: null };

  const [asked, address] = await Promise.all([askedFor(db, personId, proposal), currentAddress(db, personId)]);
  if (asked === null) {
    c.var.log.warn("consultation_window_unknown", { person_id: personId });
    return { booking, proposal, card: null };
  }
  const place = address === null ? (proposal.city ?? "") : `${address.locality}, ${address.city} ${address.pincode}`;
  return { booking, proposal, card: consultationOf(proposal, asked, place) };
}

/** What Home's offer and prompt turn on: the figures ops set, then the client's facts, read together. */
async function homeFactsOf(c: Context<AppEnv>, personId: string, now: Date) {
  const inputs = await opsInputs(c);
  const days = inputs.nextVisitDays;
  const [next, prompt] = await Promise.all([
    nextVisitFacts(c.env.DB, personId, now, days),
    promptFacts(c.env.DB, personId, now, days),
  ]);
  return { days, referralReward: inputs.referralReward, next, prompt };
}

export function registerClientMe(app: App): void {
  app.use(meRoute.path, requireClientSession);
  app.openapi(meRoute, async (c) => {
    const personId = clientOf(c).subjectId;
    const db = c.env.DB;
    const now = c.var.deps.now();
    const today = indiaDate(now);
    const tomorrow = addDays(today, 1);

    // Each read is a trip to D1 and back, so the reads that need nothing from each other go together.
    const [person, upcoming, underWay, credits, fitted, form, types, services, home] = await Promise.all([
      liveContact(db, personId),
      nextVisit(db, personId, now),
      bookingUnderWay(db, personId),
      spendableCredits(db, personId, now),
      isFitted(db, personId),
      formBookingOf(c, personId, today),
      bookableTypes(db, personId),
      servicesOnDay(db, tomorrow),
      homeFactsOf(c, personId, now),
    ]);
    if (person === null) return c.json(errorBody("session_required", c.var.requestId), 401);

    const { name } = person;
    const state = clientStateOf(fitted, upcoming !== null || form.booking !== null);
    // A form's consultation counts as booked while it stands, asked for or held.
    const booked = home.next.booked || upcoming !== null || form.proposal !== null;
    const offer = booked ? null : home.next.offer;
    const offered = offeredAmong(services, tomorrow, types).map((service) => ({
      type: service.kind,
      tier: service.tier,
      name: service.name,
      description: service.description,
      minutes: service.minutes,
      price: service.price,
    }));
    const { prompt, invoice } = await homePrompts(db, personId, home.prompt, { booked, offer }, now, home.days);

    return c.json(
      {
        state,
        name,
        first_name: firstNameOf(name),
        initials: initialsOf(name),
        consultation: form.card,
        next_visit: upcoming,
        being_booked: underWay,
        credits: credits.visits > 0 ? creditsBody(credits) : null,
        prompt,
        invoice,
        booking: { self_serve: c.var.config.settings.selfServeBooking, types, services: offered, next: offer },
        referral_reward: home.referralReward,
      },
      200,
    );
  });
}
