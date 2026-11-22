// A client's bookings held on their payment link (src/domain/booking/held-bookings.ts): what stands in the way of
// booking another of a kind, so ops are told which it is; the link texted again; and a held booking let go, its time
// freed, so another can be booked. Each within the caller's places, as booking is.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import { VISIT_TYPES } from "../../config/visit-types.ts";
import { BOOKING_WINDOWS } from "../../config/scheduling.ts";
import {
  heldBookingPerson,
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
    url: z.string().nullable().openapi({ description: "The link to pay by; null while it is still being made." }),
    open_until: z.string().openapi({ description: "When it is held until; then its time goes back." }),
    paid: z.boolean().openapi({ description: "Paid and being booked: no link to send, and it cannot be let go." }),
  })
  .strict();

const HeldBookingsSchema = z
  .object({
    visit: z
      .object({
        kind: z.enum(VISIT_TYPES).openapi({ description: "Its kind: a consultation, where a one visit was asked." }),
        date: z.iso.date(),
        window: z.enum(BOOKING_WINDOWS),
        starts_at: z.iso.datetime().nullable(),
      })
      .strict()
      .nullable()
      .openapi({ description: "A visit still to come that a second would double; null for none." }),
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
  paid: held.paid,
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
    409: errorResponse("hold_expired: it was paid, is being booked, lapsed or was let go already"),
    503: errorResponse("unavailable: Razorpay would not cancel its link or say it is shut, so it is kept; try again"),
  },
});

/** The client a hold is for, where the caller may reach them; null for none. */
async function holdInReach(c: Context<AppEnv>, holdId: string): Promise<string | null> {
  const personId = await heldBookingPerson(c.env.DB, holdId);
  if (personId === null) return null;
  return (await clientInReach(c, personId)) === null ? null : personId;
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
            kind: found.visit.kind,
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
    const now = c.var.deps.now();
    const outcome = await resendHeldLink(c.env.DB, deps, id, now);
    if (outcome === "not_found") return refuse(c, "not_found");
    if (outcome === "closed") return refuse(c, "hold_expired");
    if (outcome === "unavailable") return refuse(c, "unavailable");
    if (outcome === "resent") {
      const entry = {
        surface: "ops",
        actor: actorOf(c),
        action: "booking.link_resend",
        subject: { kind: "hold", id },
        requestId: c.var.requestId,
        detail: {},
      } as const;
      await auditStatement(c.env.DB, entry, now).run();
    }
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
    if (outcome === "unavailable") return refuse(c, "unavailable");
    return c.body(null, 204);
  });
}
