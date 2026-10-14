// A technician's word to the client from the job card (docs/decisions/0145-technician-presets.md):
//   POST /api/tech/jobs/:id/updates   on the way, at the gate, or running late, sent from our number
// It never refuses a word the phone could send again: one that reaches us too late is answered as not sent, so the
// job's queue on the phone carries on.

import { z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { techRoute } from "../../http/session-routes.ts";
import { queueMessage } from "../../http/queue-message.ts";
import { technicianOf } from "../../http/technician-session.ts";
import { timeOfUuidV7 } from "../../lib/uuidv7.ts";
import { PRESETS, recordTechnicianUpdate } from "../../domain/messages/technician-updates.ts";
import { namedJob } from "./jobs.record.ts";
import { EventIdSchema, jobId } from "./jobs.schemas.ts";

const updateRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/updates",
  summary: "Tell the client the technician is on the way, at the gate, or running late, from our number",
  request: {
    params: jobId,
    headers: EventIdSchema,
    body: {
      required: true,
      ...json(
        z
          .object({ preset: z.enum(PRESETS), minutes: z.union([z.number().int().min(1).max(120), z.null()]) })
          .strict()
          .openapi("TechnicianUpdate"),
      ),
    },
  },
  responses: {
    200: {
      description: "Queued for the client now; false for a word heard before, or too late to help",
      ...json(z.object({ sent: z.boolean() }).strict()),
    },
    400: errorResponse("invalid_request: minutes are for on the way and running late, and not for at the gate"),
    401: errorResponse("session_required; device_revoked"),
    404: errorResponse("not_found: no such job, or never this technician's"),
  },
});

export function registerTechUpdates(app: App): void {
  app.openapi(updateRoute, async (c) => {
    const { preset, minutes } = c.req.valid("json");
    if ((preset === "at_gate") !== (minutes === null)) return refuse(c, "invalid_request", ["minutes"]);
    const job = await namedJob(c, c.req.valid("param").id);
    if (job === null) return refuse(c, "not_found");
    const eventId = c.req.valid("header")["x-client-event-id"];
    const now = c.var.deps.now();
    const messageId = await recordTechnicianUpdate(c.env.DB, {
      eventId,
      appointmentId: job.id,
      personId: job.personId,
      technicianId: technicianOf(c).technicianId,
      preset,
      minutes,
      writtenAt: timeOfUuidV7(eventId) ?? now,
      now,
    });
    if (messageId !== null) await queueMessage(c, messageId);
    return c.json({ sent: messageId !== null }, 200);
  });
}
