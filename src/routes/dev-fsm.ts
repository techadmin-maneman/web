// POST /api/dev/appointments/:id/close — locally only. Locally FSM is a stub
// that remembers nothing, so no visit ever closed, and nothing that follows a
// close could be run on a laptop: the invoice pass, the referral grant after a
// first fit, the client's past visits (LIFE-17). This writes the mirror as the
// FSM sync writes it once a technician's job is closed in FSM
// (src/domain/fsm-mirror.ts), over the visit's booked window.
//
// It exists only where DEV_ROUTES is on, which the startup guard refuses
// outside local, and only local apps register it (src/app.ts). It is in no API
// document: nothing but a developer calls it (docs/getting-started.md).

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { minutesBetween } from "../lib/durations.ts";

/** What each outcome is in FSM, and in the mirror: done is Complete Work, partial is Terminate. */
const CLOSES = {
  done: { status: "completed", fsmStatus: "Completed" },
  partial: { status: "terminated", fsmStatus: "Terminated" },
} as const;

const closeRoute = createRoute({
  method: "post",
  path: "/api/dev/appointments/{id}/close",
  summary: "Locally only: close a visit as FSM would once its technician closes it",
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
      description: "Closed in the mirror",
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

export function registerDevFsm(app: App): void {
  app.openapi(closeRoute, async (c) => {
    const { requestId, deps, log } = c.var;
    const { id } = c.req.valid("param");
    const { outcome } = c.req.valid("json");
    const db = c.env.DB;
    const now = deps.now().toISOString();

    const visit = await db
      .prepare("SELECT status, window_start, window_end FROM appointments WHERE id = ?1 AND deleted_at IS NULL")
      .bind(id)
      .first<{ status: string; window_start: string | null; window_end: string | null }>();
    if (visit === null) return c.json(errorBody("not_found", requestId), 404);
    if (!["scheduled", "dispatched", "in_progress"].includes(visit.status)) {
      return c.json(errorBody("not_changeable", requestId), 409);
    }

    const { status, fsmStatus } = CLOSES[outcome];
    const minutes =
      visit.window_start !== null && visit.window_end !== null
        ? minutesBetween(visit.window_start, visit.window_end)
        : null;
    await db.batch([
      db
        .prepare(
          "UPDATE appointments SET status = ?2, fsm_status = ?3, fsm_modified_at = ?4, synced_at = ?4 WHERE id = ?1",
        )
        .bind(id, status, fsmStatus, now),
      db
        .prepare(
          `INSERT INTO visits (id, appointment_id, started_at, ended_at, duration_minutes, outcome, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
           ON CONFLICT (appointment_id) DO UPDATE SET
             started_at = excluded.started_at, ended_at = excluded.ended_at,
             duration_minutes = excluded.duration_minutes, outcome = excluded.outcome, updated_at = excluded.updated_at`,
        )
        .bind(crypto.randomUUID(), id, visit.window_start, visit.window_end, minutes, outcome, now),
    ]);
    log.info("dev_visit_closed", { appointment_id: id, status });
    return c.json({ appointment_id: id, status }, 200);
  });
}
