// GET /api/me: the client app's Home card (docs/prompts/phase2-backend.md,
// "Read endpoints"). Until the FSM mirror arrives (P2-M2), a client is a lead
// whose consultation is their Phase 1 booking; "fitted" arrives with the mirror.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { WINDOW_LABELS, windowLabel, type VisitWindow } from "../config/booking.ts";
import { requireClientSession } from "../http/client-session.ts";
import { errorBody, errorResponse } from "../http/errors.ts";

export const MeSchema = z
  .object({
    state: z.enum(["lead", "nothing_booked"]),
    first_name: z.string(),
    consultation: z
      .object({ date: z.iso.date(), window_label: z.enum(WINDOW_LABELS) })
      .strict()
      .nullable()
      .openapi({ description: "The booked consultation: its proposed date and window, to be confirmed on WhatsApp." }),
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

    const booking = await db
      .prepare(
        `SELECT proposed_visit_date, first_choice_window FROM leads
         WHERE person_id = ?1 AND proposed_visit_date IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(session.subjectId)
      .first<{ proposed_visit_date: string; first_choice_window: VisitWindow }>();

    return c.json(
      {
        state: booking === null ? ("nothing_booked" as const) : ("lead" as const),
        first_name: person.name.trim().split(/\s+/)[0] ?? "",
        consultation:
          booking === null
            ? null
            : { date: booking.proposed_visit_date, window_label: windowLabel(booking.first_choice_window) },
      },
      200,
    );
  });
}
