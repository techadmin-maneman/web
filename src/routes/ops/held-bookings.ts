// A client's bookings held on their payment link (src/domain/booking/held-bookings.ts): what stands in the way of
// booking another of a kind, so ops are told which it is; the link texted again; and a held booking let go, its time
// freed, so another can be booked. Each within the caller's places, as booking is.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import { VISIT_TYPES } from "../../config/visit-types.ts";
import { BOOKING_WINDOWS } from "../../config/scheduling.ts";
import {
  heldBookingsOf,
  inTheWay,
  letHeldBookingGo,
  resendHeldLink,
  type HeldBooking,
} from "../../domain/booking/held-bookings.ts";
import { auditStatement } from "../../domain/platform/audit.ts";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { clientInReach } from "../../http/staff-access.ts";
import type { Context } from "hono";
import type { AppEnv } from "../../http/context.ts";

const HeldSchema = z
  .object({
    hold_id: z.uuid(),
    type: z.enum(VISIT_TYPES),
    date: z.iso.date(),
    starts_at: z.iso.datetime().nullable(),
    amount: z.number().int().openapi({ description: "What the client pays, in paise, GST included." }),
    url: z.string().openapi({ description: "The link to pay by." }),
    open_until: z.string().openapi({ description: "When it is held until; then its time goes back." }),
  })
  .strict();

const HeldBookingsSchema = z
  .object({
    visit: z
      .object({ date: z.iso.date(), window: z.enum(BOOKING_WINDOWS), starts_at: z.iso.datetime().nullable() })
      .strict()
      .nullable()
      .openapi({ description: "A visit of the kind asked still to come, which a second would double; null for none." }),
    held: z.array(HeldSchema).openapi({ description: "Bookings held on their link, soonest first." }),
  })
  .openapi("OpsHeldBookings");

const heldBody = (held: HeldBooking) => ({
  hold_id: held.holdId,
  type: held.type,
  date: held.date,
  starts_at: held.startsAt,
  amount: held.amount,
  url: held.url,
  open_until: held.openUntil,
});

const listRoute = opsRoute({
  method: "get",
  path: "/api/clients/{id}/held-bookings",
  summary: "The client's bookings held on their payment link, and what stands in the way of booking a kind",
  request: {
    params: z.object({ id: z.uuid() }),
    query: z.object({
      kind: z
        .enum(VISIT_TYPES)
        .optional()
        .openapi({ description: "The kind of visit to be booked; every kind if left out." }),
      one_visit: z.enum(["true", "false"]).optional().openapi({ description: "A consultation and fit in one visit." }),
    }),
  },
  responses: {
    200: { description: "What is held, and in the way", ...json(HeldBookingsSchema) },
    404: errorResponse("not_found: no such client within the reader's places"),
  },
});

const OutcomeSchema = z
  .object({
    outcome: z.enum(["resent", "not_texted"]).openapi({
      description:
        "resent: Razorpay texted the link again; not_texted: messaging may not text this number (a staging test record).",
    }),
  })
  .openapi("OpsHeldLinkSent");

const holdParams = z.object({ id: z.uuid().openapi({ description: "The held booking (its hold)." }) });

const sendRoute = opsRoute({
  method: "post",
  path: "/api/holds/{id}/send-link",
  summary: "Text a held booking's payment link to the client again",
  request: { params: holdParams },
  responses: {
    200: { description: "What sending it came to", ...json(OutcomeSchema) },
    404: errorResponse("not_found: no such held booking within the caller's places"),
    409: errorResponse("hold_expired: it was paid, lapsed or let go, so its link is closed"),
    503: errorResponse("unavailable: Razorpay did not answer; try again in a minute"),
  },
});

const letGoRoute = opsRoute({
  method: "post",
  path: "/api/holds/{id}/let-go",
  summary: "Let a booking held on its payment link go, its link cancelled and its time freed",
  request: { params: holdParams },
  responses: {
    204: { description: "Let go: its link cancelled and its time freed" },
    404: errorResponse("not_found: no such held booking within the caller's places"),
    409: errorResponse("hold_expired: it was paid, lapsed or let go already"),
  },
});

/** The client a hold is for, where the caller may reach them; null for none. */
async function holdInReach(c: Context<AppEnv>, holdId: string): Promise<string | null> {
  const hold = await c.env.DB.prepare("SELECT person_id FROM slot_holds WHERE id = ?1 AND pay_by_link = 1")
    .bind(holdId)
    .first<{ person_id: string }>();
  if (hold === null) return null;
  return (await clientInReach(c, hold.person_id)) === null ? null : hold.person_id;
}

export function registerOpsHeldBookings(app: App): void {
  app.openapi(listRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { kind, one_visit } = c.req.valid("query");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    const now = c.var.deps.now();
    const found =
      kind === undefined
        ? { visit: null, held: await heldBookingsOf(c.env.DB, id, now) }
        : await inTheWay(c.env.DB, { personId: id, kind, oneVisit: one_visit === "true", now });
    const visit =
      found.visit === null
        ? null
        : {
            date: found.visit.date,
            window: found.visit.window,
            starts_at: found.visit.startsAt?.toISOString() ?? null,
          };
    return c.json({ visit, held: found.held.map(heldBody) }, 200);
  });

  app.openapi(sendRoute, async (c) => {
    const { id } = c.req.valid("param");
    if ((await holdInReach(c, id)) === null) return refuse(c, "not_found");
    const deps = { ...c.var.deps, log: c.var.log, messagingSettings: c.var.config.settings.messaging };
    const outcome = await resendHeldLink(c.env.DB, deps, id, c.var.deps.now());
    if (outcome === "not_found") return refuse(c, "not_found");
    if (outcome === "closed") return refuse(c, "hold_expired");
    if (outcome === "unavailable") return refuse(c, "unavailable");
    return c.json({ outcome }, 200);
  });

  app.openapi(letGoRoute, async (c) => {
    const { id } = c.req.valid("param");
    if ((await holdInReach(c, id)) === null) return refuse(c, "not_found");
    const now = c.var.deps.now();
    const reason = "ops let it go";
    const entry = {
      surface: "ops",
      actor: actorOf(c),
      action: "booking.give_back",
      subject: { kind: "hold", id },
      requestId: c.var.requestId,
      detail: { reason: "let_go" },
    } as const;
    const outcome = await letHeldBookingGo(c.env.DB, { payments: c.var.deps.payments, log: c.var.log }, id, {
      now,
      reason,
      alongside: [auditStatement(c.env.DB, entry, now)],
    });
    if (outcome === "not_found") return refuse(c, "not_found");
    if (outcome === "closed") return refuse(c, "hold_expired");
    return c.body(null, 204);
  });
}
