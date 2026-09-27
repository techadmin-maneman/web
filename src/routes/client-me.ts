// GET /api/me: the client app's Home card (docs/prompts/phase2-backend.md,
// "Read endpoints"). A client is fitted once a first fit or a later visit is
// done (the FSM mirror, docs/decisions/0032-fsm-mirror.md); a lead has a
// consultation, from the mirror or from their booking on the site before FSM
// has it; else nothing is booked. The next visit comes from the mirror, and
// the credit tile and board B1's one prompt beneath it (src/domain/home-prompt.ts).

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { WINDOW_LABELS, type WindowLabel } from "../config/booking.ts";
import { BOOKING_WINDOWS, type BookingWindow } from "../config/scheduling.ts";
import { VISIT_TYPES } from "../config/visit-types.ts";
import { CLIENT_STATES, clientStateOf, isFitted, nextVisit } from "../domain/client-visits.ts";
import { creditBalance } from "../domain/credits.ts";
import { homePrompt } from "../domain/home-prompt.ts";
import { bookableTypes } from "../domain/scheduling.ts";
import { currentAddress, liveName } from "../domain/profile.ts";
import { hasFsmVisit, latestProposal, windowAskedFor } from "../domain/proposed-visits.ts";
import { requireClientSession } from "../http/client-session.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { firstNameOf, initialsOf } from "../lib/names.ts";
import { CreditsSchema } from "./client-refer.ts";
import { VisitSummarySchema } from "./client-visits.ts";

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
      })
      .strict()
      .nullable()
      .openapi({
        description:
          "A booking's proposed consultation, before FSM has the visit: from the site's form, or a Phase 1 booking to be confirmed on WhatsApp. Null once the mirror has the visit.",
      }),
    next_visit: z
      .union([VisitSummarySchema, z.null()])
      .openapi({ description: "The next visit that has not happened, from FSM: a consultation for a lead." }),
    credits: z
      .union([CreditsSchema, z.null()])
      .openapi({ description: "The credit tile: balance and earliest expiry; null with none left." }),
    prompt: z
      .union([
        z.object({ kind: z.literal("address") }).strict(),
        z.object({ kind: z.literal("replacement_due"), month: z.string().regex(/^\d{4}-\d{2}$/) }).strict(),
        z
          .object({
            kind: z.literal("invoice_ready"),
            visit_id: z.uuid(),
            date: z.iso.date().openapi({ description: "India's date of the visit." }),
            type: z.union([z.enum(VISIT_TYPES), z.null()]),
          })
          .strict(),
        z.null(),
      ])
      .openapi({
        description:
          "Board B1's one contextual prompt, the first that applies: no address given while something is booked; " +
          "the month the piece in wear falls due, never the day (ADR 0059); an invoice issued in the last " +
          "fortnight. Null when none applies.",
      }),
    booking: z
      .object({
        self_serve: z.boolean().openapi({ description: "Booking in the app is on; off, the app opens WhatsApp." }),
        types: z.array(z.enum(VISIT_TYPES)).openapi({ description: "What the client may book now." }),
      })
      .strict(),
  })
  .strict()
  .openapi("Me");

/** The words the Phase 1 booked page had for a window. It had none for the afternoon. */
const PHASE1_WORDS: Partial<Record<BookingWindow, WindowLabel>> = { morning: "before noon", evening: "after four" };

export const meRoute = createRoute({
  method: "get",
  path: "/api/me",
  summary: "The Home card: who the client is and what is booked",
  responses: {
    200: { description: "The Home card", content: { "application/json": { schema: MeSchema } } },
    401: errorResponse("session_required"),
  },
});

export function registerClientMe(app: App): void {
  app.use(meRoute.path, requireClientSession);
  app.openapi(meRoute, async (c) => {
    const session = c.var.clientSession;
    if (session === undefined) return c.json(errorBody("session_required", c.var.requestId), 401);

    const db = c.env.DB;
    const name = await liveName(db, session.subjectId);
    if (name === null) return c.json(errorBody("session_required", c.var.requestId), 401);

    const now = c.var.deps.now();
    const upcoming = await nextVisit(db, session.subjectId, now);
    const credits = await creditBalance(db, session.subjectId, now);
    const fitted = await isFitted(db, session.subjectId);
    const booking = await latestProposal(db, session.subjectId);
    // A booking's proposal stands only until FSM has any visit for the person.
    const proposal = (await hasFsmVisit(db, session.subjectId)) ? null : booking;
    const window = proposal === null ? null : await windowAskedFor(db, session.subjectId, proposal);
    if (proposal !== null && window === null) {
      c.var.log.warn("consultation_window_unknown", { person_id: session.subjectId });
    }
    const address = proposal === null ? null : await currentAddress(db, session.subjectId);
    const place = address === null ? (booking?.city ?? "") : `${address.locality}, ${address.city} ${address.pincode}`;
    const state = clientStateOf(fitted, upcoming !== null || booking !== null);

    return c.json(
      {
        state,
        name,
        first_name: firstNameOf(name),
        initials: initialsOf(name),
        consultation:
          proposal === null || window === null
            ? null
            : { date: proposal.proposed_visit_date, window, window_label: PHASE1_WORDS[window] ?? null, place },
        next_visit: upcoming,
        credits: credits.visits > 0 ? { visits: credits.visits, earliest_expiry: credits.earliestExpiry } : null,
        prompt: await homePrompt(db, session.subjectId, state, now),
        booking: {
          self_serve: c.var.config.settings.selfServeBooking,
          types: await bookableTypes(db, session.subjectId),
        },
      },
      200,
    );
  });
}
