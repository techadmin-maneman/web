// POST /api/dev/appointments/:id/close — locally only. Closes a visit as a technician's phone closes it, over its booked
// window, so what follows a close can be run on a laptop without a phone: the invoice pass, the referral grant after a
// first fit, the client's past visits.
//
// It exists only where DEV_ROUTES is on, which the startup guard refuses outside local, and only local apps register
// it (src/app.ts). It is in no API document: nothing but a developer calls it (docs/getting-started.md).

import { createRoute, z } from "@hono/zod-openapi";
import { closeVisit, moveVisit } from "../domain/visit-status.ts";
import type { App } from "../http/context.ts";
import { errorBody, errorResponse } from "../http/errors.ts";

const CLOSED_AS = { done: "completed", partial: "terminated" } as const;

const closeRoute = createRoute({
  method: "post",
  path: "/api/dev/appointments/{id}/close",
  summary: "Locally only: close a visit as its technician's phone would",
  request: {
    params: z.object({ id: z.uuid() }),
    body: {
      content: {
        "application/json": { schema: z.object({ outcome: z.enum(["done", "partial"]) }).strict() },
      },
    },
  },
  responses: {
    200: {
      description: "Closed",
      content: {
        "application/json": {
          schema: z.object({ appointment_id: z.string(), status: z.enum(["completed", "terminated"]) }).strict(),
        },
      },
    },
    404: errorResponse("not_found"),
    409: errorResponse("not_changeable: the visit is already closed or cancelled"),
  },
});

export function registerDevVisits(app: App): void {
  app.openapi(closeRoute, async (c) => {
    const { requestId, deps, log } = c.var;
    const { id } = c.req.valid("param");
    const { outcome } = c.req.valid("json");
    const db = c.env.DB;
    const at = deps.now().toISOString();

    const visit = await db
      .prepare("SELECT window_start, window_end FROM appointments WHERE id = ?1 AND deleted_at IS NULL")
      .bind(id)
      .first<{ window_start: string | null; window_end: string | null }>();
    if (visit === null) return c.json(errorBody("not_found", requestId), 404);

    const times = { startedAt: visit.window_start, endedAt: visit.window_end };
    const [moved] = await db.batch([
      moveVisit(db, id, outcome, at),
      closeVisit(db, id, outcome, times, null, at),
    ]);
    if (moved?.meta.changes !== 1) return c.json(errorBody("not_changeable", requestId), 409);

    const status = CLOSED_AS[outcome];
    log.info("dev_visit_closed", { appointment_id: id, status });
    return c.json({ appointment_id: id, status }, 200);
  });
}
