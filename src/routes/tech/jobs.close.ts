// What the technician does from a closed visit (docs/decisions/0246-closed-and-sent-back.md): text a one visit's
// payment link to the client again, three times a day at most, and suggest how to finish a visit left partly done.
// Each is for the technician's own visit alone.

import { z } from "@hono/zod-openapi";
import { techRoute } from "../../http/session-routes.ts";
import type { App } from "../../http/context.ts";
import { workableJob } from "../../domain/field/workable-job.ts";
import { linkOfVisit, resendLink } from "../../domain/money/payment-links.ts";
import { takeOne } from "../../domain/sign-in/rate-limit.ts";
import { askToFinish } from "../../domain/visits/finish-asks.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { technicianOf } from "../../http/technician-session.ts";
import { FINISH_ASKS } from "../../policy/finish-the-work.ts";
import type { Context } from "hono";
import type { AppEnv } from "../../http/context.ts";

const jobId = z.object({ id: z.uuid() });

const resendRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/payment-link/resend",
  summary: "Text a one visit's client its payment link again, from the visit's close",
  request: { params: jobId },
  responses: {
    200: {
      description: "What sending it again came to",
      ...json(
        z
          .object({
            outcome: z.enum(["resent", "sent", "not_texted", "paid", "refused"]).openapi({
              description:
                "resent or sent: texted; not_texted: messaging may not text this number; paid: the client has paid; " +
                "refused: Razorpay would not make it, and ops are told on the Tasks board.",
            }),
          })
          .strict()
          .openapi("TechnicianLinkResent"),
      ),
    },
    401: errorResponse("session_required; device_revoked; technician_inactive: ops switched the technician off"),
    404: errorResponse("not_found: no such job of this technician's, or no payment link on it"),
    429: errorResponse("rate_limited: texted three times today already"),
    503: errorResponse("unavailable: Razorpay did not answer; try again in a minute"),
  },
});

const finishRoute = techRoute({
  method: "post",
  path: "/api/tech/jobs/{id}/finish-ask",
  summary: "Suggest to ops how to finish a visit left partly done, or not fitted",
  request: {
    params: jobId,
    body: {
      required: true,
      ...json(
        z
          .object({
            ask: z.enum(FINISH_ASKS).openapi({
              description: "Tomorrow morning, tomorrow evening, or ops to call the client. A later one replaces it.",
            }),
          })
          .strict()
          .openapi("TechnicianFinishAsk"),
      ),
    },
  },
  responses: {
    204: { description: "Kept on the visit's task, for ops to book" },
    401: errorResponse("session_required; device_revoked; technician_inactive: ops switched the technician off"),
    404: errorResponse("not_found: no such job of this technician's"),
    409: errorResponse("not_changeable: the visit is not closed partly done"),
  },
});

/** The technician's own visit, by its ID; null for any other. */
async function ownVisit(c: Context<AppEnv>, id: string): Promise<string | null> {
  const job = await workableJob(c.env.DB, id);
  return job?.technicianId === technicianOf(c).technicianId ? job.id : null;
}

export function registerTechCloseActions(app: App): void {
  app.openapi(resendRoute, async (c) => {
    const { deps, log } = c.var;
    const visit = await ownVisit(c, c.req.valid("param").id);
    const link = visit === null ? null : await linkOfVisit(c.env.DB, visit);
    if (visit === null || link === null) return refuse(c, "not_found");
    const now = deps.now();
    if (!(await takeOne(c.env.DB, "payment_link_resend:visit", visit, { now, settings: c.var.config.settings }))) {
      return refuse(c, "rate_limited");
    }
    const linkDeps = { ...deps, log, messagingSettings: c.var.config.settings.messaging };
    const outcome = await resendLink(c.env.DB, linkDeps, link, now);
    if (outcome === "not_found") return refuse(c, "not_found");
    if (outcome === "unavailable") return refuse(c, "unavailable");
    return c.json({ outcome }, 200);
  });

  app.openapi(finishRoute, async (c) => {
    const visit = await ownVisit(c, c.req.valid("param").id);
    if (visit === null) return refuse(c, "not_found");
    const { ask } = c.req.valid("json");
    const kept = await askToFinish(c.env.DB, { appointmentId: visit, ask, now: c.var.deps.now() });
    if (!kept) return refuse(c, "not_changeable");
    c.var.log.info("visit_finish_asked", { appointment_id: visit, ask });
    return c.body(null, 204);
  });
}
