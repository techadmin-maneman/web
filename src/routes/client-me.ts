// GET /api/me: the client app's Home card (docs/prompts/phase2-backend.md,
// "Read endpoints"). A client is fitted once a first fit or a later visit is
// done (the FSM mirror, docs/decisions/0032-fsm-mirror.md); a lead has a
// consultation, from the mirror or their Phase 1 booking; else nothing is
// booked. The next visit comes from the mirror.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { WINDOW_LABELS, windowLabel, type VisitWindow } from "../config/booking.ts";
import { VISIT_TYPES } from "../config/visit-types.ts";
import { CLIENT_STATES, clientStateOf, isFitted, nextVisit } from "../domain/client-visits.ts";
import { creditBalance } from "../domain/credits.ts";
import { bookableTypes } from "../domain/scheduling.ts";
import { currentAddress } from "../domain/profile.ts";
import { requireClientSession } from "../http/client-session.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { initialsOf } from "../lib/names.ts";
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
        window_label: z.enum(WINDOW_LABELS),
        place: z.string().openapi({
          description: "Where it is: the saved address (locality, city and pincode), else the booking's city.",
        }),
      })
      .strict()
      .nullable()
      .openapi({
        description:
          "A Phase 1 booking's proposed consultation, to be confirmed on WhatsApp. Null once the mirror has the visit.",
      }),
    next_visit: z
      .union([VisitSummarySchema, z.null()])
      .openapi({ description: "The next visit that has not happened, from FSM: a consultation for a lead." }),
    credits: z
      .union([CreditsSchema, z.null()])
      .openapi({ description: "The credit tile: balance and earliest expiry; null with none left." }),
    prompt: z
      .null()
      .openapi({ description: "The one contextual prompt, e.g. a replacement due. Arrives with the pieces (P2-M4)." }),
    booking: z
      .object({
        self_serve: z.boolean().openapi({ description: "Booking in the app is on; off, the app opens WhatsApp." }),
        types: z.array(z.enum(VISIT_TYPES)).openapi({ description: "What the client may book now." }),
      })
      .strict(),
  })
  .strict()
  .openapi("Me");

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
    const person = await db
      .prepare("SELECT name FROM people WHERE id = ?1 AND erased_at IS NULL")
      .bind(session.subjectId)
      .first<{ name: string }>();
    if (person === null) return c.json(errorBody("session_required", c.var.requestId), 401);

    const now = c.var.deps.now();
    const upcoming = await nextVisit(db, session.subjectId, now);
    const credits = await creditBalance(db, session.subjectId, now);
    const fitted = await isFitted(db, session.subjectId);
    const booking = await db
      .prepare(
        `SELECT proposed_visit_date, first_choice_window, city FROM leads
         WHERE person_id = ?1 AND proposed_visit_date IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(session.subjectId)
      .first<{ proposed_visit_date: string; first_choice_window: VisitWindow; city: string | null }>();
    // A Phase 1 booking's proposal stands only until FSM has any visit for the person.
    const inFsm =
      (await db
        .prepare("SELECT 1 FROM appointments WHERE person_id = ?1 AND deleted_at IS NULL LIMIT 1")
        .bind(session.subjectId)
        .first()) !== null;
    const proposal = inFsm ? null : booking;
    const address = proposal === null ? null : await currentAddress(db, session.subjectId);
    const place = address === null ? (booking?.city ?? "") : `${address.locality}, ${address.city} ${address.pincode}`;

    return c.json(
      {
        state: clientStateOf(fitted, upcoming !== null || booking !== null),
        name: person.name,
        first_name: person.name.trim().split(/\s+/)[0] ?? "",
        initials: initialsOf(person.name),
        consultation:
          proposal === null
            ? null
            : { date: proposal.proposed_visit_date, window_label: windowLabel(proposal.first_choice_window), place },
        next_visit: upcoming,
        credits: credits.visits > 0 ? { visits: credits.visits, earliest_expiry: credits.earliestExpiry } : null,
        prompt: null,
        booking: {
          self_serve: c.var.config.settings.selfServeBooking,
          types: await bookableTypes(db, session.subjectId),
        },
      },
      200,
    );
  });
}
