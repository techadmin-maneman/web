// Booking in the app (docs/decisions/0045-self-serve-booking.md): the windows open for a service, one held for ten
// minutes while the client pays, and its booking. With self-serve booking off, every route answers ops_assisted. No
// window is held before the client has given the visit's address, and with `moving` a hold moves one of their visits.
// The windows open are ./availability.ts; holding one, and booking it, are here.
//
//   GET    /api/availability?type=&tier=&from=   14 days of the windows the visit can start in, and who could come
//   POST   /api/holds                      hold a window
//   GET    /api/holds/:id                  a hold: lapsed, paid, or booked as a visit
//   DELETE /api/holds/:id                  let it go
//   POST   /api/bookings                   book a hold: Checkout's order, or, if free, sent to be booked

import { z } from "@hono/zod-openapi";
import { BOOKING_WINDOWS } from "../../config/scheduling.ts";
import { VISIT_TYPES, type VisitType } from "../../config/visit-types.ts";
import { holdSlot } from "../../domain/booking/hold-slot.ts";
import { clientHold, holdAtCheckout, releaseHold } from "../../domain/booking/holds.ts";
import { currentAddress } from "../../domain/clients/profile.ts";
import { isServed } from "../../domain/clients/service-area.ts";
import { spendableCredits } from "../../domain/money/credits.ts";
import { codeToCarry } from "../../domain/money/discount-code-uses.ts";
import { keepShownConsents, recordBookingConsents } from "../../domain/privacy/booking-consents.ts";
import { bookable, movedService, moveTermsFor, rangeFor, soldAs, startCheckout } from "../../http/client-booking.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { errorBody, errorResponse, refuse } from "../../http/errors.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { selfServeRoute } from "../../http/session-routes.ts";
import { visitorOf } from "../../http/visitor.ts";
import { GIVEN_BY_BOOKING, isFullAddress } from "../../policy/booking.ts";
import { takesCredit } from "../../policy/referral-reward.ts";
import { BookingSchema, HoldSchema, Tier } from "../schemas/booking.ts";

const holdRoute = selfServeRoute({
  method: "post",
  path: "/api/holds",
  summary: "Hold a window for ten minutes while the client pays",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              type: z.enum(VISIT_TYPES),
              tier: Tier,
              date: z.iso.date(),
              window: z.enum(BOOKING_WINDOWS),
              moving: z.uuid().optional().openapi({ description: "One of the client's visits, to move instead." }),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    201: { description: "Held", content: { "application/json": { schema: HoldSchema } } },
    401: errorResponse("session_required"),
    409: errorResponse(
      "address_required: the client has not given the address the visit goes to; taken: nobody is free in that " +
        "window now; not_changeable; or ops_assisted",
    ),
    422: errorResponse(
      "not_bookable: this kind of visit, this service, or that day, is not open to the client; no_product: a first " +
        "fit, on a day the console offers no hair system; not_served: the client's address is in a pincode we do not " +
        "come to",
    ),
  },
});

const holdByIdRoute = selfServeRoute({
  method: "get",
  path: "/api/holds/{id}",
  summary: "One of the client's holds",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: "The hold", content: { "application/json": { schema: HoldSchema } } },
    401: errorResponse("session_required"),
    404: errorResponse("not_found"),
    409: errorResponse("ops_assisted"),
  },
});

const BookingStartSchema = z
  .object({
    hold_id: z.uuid(),
    consents: z
      .array(z.enum(GIVEN_BY_BOOKING))
      .max(GIVEN_BY_BOOKING.length)
      .optional()
      .openapi({
        description:
          "The photograph purposes the pay step showed its lines for. Booking agrees to each the client has never " +
          "decided on, recorded once the booking is paid for, or at once for a free visit (ADR 0080); left out, none.",
      }),
  })
  .strict()
  .openapi("BookingStart");

const bookingRoute = selfServeRoute({
  method: "post",
  path: "/api/bookings",
  summary: "Book a held window: pay through Checkout, or, if free, book it at once",
  request: { body: { required: true, content: { "application/json": { schema: BookingStartSchema } } } },
  responses: {
    201: { description: "Started", content: { "application/json": { schema: BookingSchema } } },
    400: errorResponse("invalid_request"),
    401: errorResponse("session_required"),
    409: errorResponse("hold_expired: the hold lapsed, was let go, or is booked already; or ops_assisted"),
  },
});

const releaseRoute = selfServeRoute({
  method: "delete",
  path: "/api/holds/{id}",
  summary: "Let a hold go",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    204: {
      description:
        "Let go, or already gone; or kept, when it has a Razorpay order and its pay_by has not passed, since a " +
        "payment may still land on it.",
    },
    401: errorResponse("session_required"),
    409: errorResponse("ops_assisted"),
  },
});

/** Whether a credit pays for the hold: one the kind of visit and move can take, while the client has one to spend. */
async function creditPays(
  db: D1Database,
  hold: { personId: string; type: VisitType; moveKind: "move" | "replace" | null },
  now: Date,
): Promise<boolean> {
  if (!takesCredit(hold.type, hold.moveKind)) return false;
  return (await spendableCredits(db, hold.personId, now)).visits > 0;
}

export function registerClientBooking(app: App): void {
  app.openapi(holdRoute, async (c) => {
    const personId = clientOf(c).subjectId;
    const { type, tier, date, window, moving: movingId } = c.req.valid("json");
    const now = c.var.deps.now();
    // Each read is a trip to D1 and back, so the reads that need nothing from each other go together.
    const [move, offered, range, address, inputs] = await Promise.all([
      movingId === undefined ? null : moveTermsFor({ c, personId, visitId: movingId, type, on: date }),
      movingId === undefined ? bookable(c, personId, { type, tier }, date) : null,
      rangeFor(c, personId, type),
      currentAddress(c.env.DB, personId),
      opsInputs(c),
    ]);
    if (movingId !== undefined && move === null) return refuse(c, "not_changeable");
    if (typeof offered === "string") return c.json(errorBody(offered, c.var.requestId), 422);
    const moves =
      move === null
        ? undefined
        : { visit: move.moving, kind: move.terms.move.cost === "charged" ? ("replace" as const) : ("move" as const) };
    const moveKind = moves?.kind ?? null;
    const [service, sold, useCredit, served, atCheckout] = await Promise.all([
      move === null ? offered : movedService(c, move.terms.visit),
      soldAs(c, { type, date, move: move?.terms ?? null, kind: moveKind }, inputs),
      creditPays(c.env.DB, { personId, type, moveKind }, now),
      isFullAddress(address) ? isServed(c.env.DB, address.pincode) : false,
      // A client back from Checkout without paying who picks the same window again gets their hold back, whose order a
      // payment may still land on, rather than a second technician's time.
      move === null && offered !== null
        ? holdAtCheckout(c.env.DB, { personId, type, tier: offered.tier, date, window, now })
        : null,
    ]);
    const price = move === null ? (offered?.price ?? null) : move.terms.move.price;
    if (service === null || price === null || date < range.opens || date > range.last) {
      return refuse(c, "not_bookable");
    }
    if (!isFullAddress(address)) return refuse(c, "address_required");
    if (!served) return refuse(c, "not_served");
    const resumed = atCheckout === null ? null : await clientHold(c.env.DB, atCheckout, personId, now);
    if (resumed !== null) return c.json(resumed, 201);
    // A visit moved late books a new one in its place, which keeps the visit's discount code, unless a credit pays it
    // (docs/decisions/0108-discount-codes.md).
    const carried =
      moves?.kind === "replace" && !useCredit ? await codeToCarry(c.env.DB, moves.visit.visitId, price, now) : null;
    const hold = await holdSlot({
      db: c.env.DB,
      input: {
        personId,
        service: { type, tier: service.tier, minutes: service.minutes },
        date,
        window,
        price: carried?.price ?? price,
        lateFee: sold.lateFee,
        terms: sold.terms,
        pincode: address.pincode,
        useCredit,
        from: "app",
        ...(moves === undefined ? {} : { moves }),
        afterHold: (holdId) => (carried === null ? [] : [carried.useOn(holdId)]),
      },
      now,
      holdSeconds: inputs.paymentHold.countdown * 60,
      graceSeconds: inputs.paymentHold.grace * 60,
    });
    if (hold === null) return refuse(c, "taken");
    c.var.log.info("slot_held", { hold_id: hold.id, type, tier: service.tier, date, window });
    const held = await clientHold(c.env.DB, hold.id, personId, now);
    if (held === null) return refuse(c, "taken");
    return c.json(held, 201);
  });

  app.openapi(holdByIdRoute, async (c) => {
    const session = clientOf(c);
    const held = await clientHold(c.env.DB, c.req.valid("param").id, session.subjectId, c.var.deps.now());
    if (held === null) return refuse(c, "not_found");
    return c.json(held, 200);
  });

  registerHoldOutcomes(app);
}

/** What becomes of a hold: booked, once paid or at once when free, or let go. */
function registerHoldOutcomes(app: App): void {
  app.openapi(bookingRoute, async (c) => {
    const session = clientOf(c);
    const { hold_id: holdId, consents = [] } = c.req.valid("json");
    const booking = await startCheckout(c, holdId, session.subjectId);
    if (booking === null) return refuse(c, "hold_expired");
    const db = c.env.DB;
    await keepShownConsents(db, {
      personId: session.subjectId,
      holdId,
      shown: consents,
      ipHash: (await visitorOf(c)).ipHash,
    });
    // A free visit is confirmed already; a paid one is once Razorpay's webhook says so.
    await recordBookingConsents(db, { holdId, requestId: c.var.requestId, now: c.var.deps.now() });
    return c.json(booking, 201);
  });

  app.openapi(releaseRoute, async (c) => {
    const session = clientOf(c);
    await releaseHold(c.env.DB, {
      holdId: c.req.valid("param").id,
      personId: session.subjectId,
      now: c.var.deps.now(),
    });
    return c.body(null, 204);
  });
}
