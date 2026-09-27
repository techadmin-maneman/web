// Booking in the app (docs/decisions/0045-self-serve-booking.md): the days and
// windows open for a service (board C2 and C3), and a window held for ten
// minutes while the client pays (C4). Behind SELF_SERVE_BOOKING: off, every
// route answers 409 ops_assisted and the app opens WhatsApp to ops instead.
//
// A visit may be booked from tomorrow as far ahead as ops' horizon, 45 days to
// begin with, and a first fit no sooner than ops' lead time after the
// consultation (docs/decisions/0086-the-next-visit-is-offered.md). The strip
// is 14 days from the day asked for, within those.
//
//   GET    /api/availability?type=&tier=&from=   14 days of three windows, and who could come
//   POST   /api/holds                      hold a window
//   GET    /api/holds/:id                  a hold: lapsed, paid, or booked as a visit
//   DELETE /api/holds/:id                  let it go
//   POST   /api/bookings                   book a hold: Checkout's order, or, if free, straight to FSM
//
// With `moving`, availability and a hold are for moving one of the client's
// visits (docs/decisions/0046-moving-and-cancelling.md): with its technician,
// priced at what the move costs now.
//
// No slot is held, for a new visit or a move, until the client has given the
// address the visit goes to, and the hold carries its pincode
// (docs/decisions/0079-an-address-before-a-slot.md). The tap that books a new
// visit also agrees to the photograph purposes the pay step showed, each only
// while the client has never decided on it
// (docs/decisions/0080-consents-given-by-booking.md).
//
// Once paid for, a hold keeps its time until it is booked or refunded, and the
// client can no longer let it go (docs/decisions/0068-a-paid-hold-is-kept.md).
//
// A booking is for a service: a kind of visit, and the tier the client chose
// of it, the kind's standard one where they name none. The hold keeps the
// service with its price, late fee and length as they are when it is made
// (docs/decisions/0085-services-ops-can-edit.md). A move keeps its visit's own.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../http/context.ts";
import { PRICE_TIER } from "../config/ops-settings.ts";
import { BOOKING_DAYS, BOOKING_WINDOWS, HOLD_SECONDS } from "../config/scheduling.ts";
import { FSM_SERVICE_NAMES, VISIT_TYPES, type VisitType } from "../config/visit-types.ts";
import { recordBookingConsents } from "../domain/booking-consents.ts";
import { startBooking } from "../domain/bookings.ts";
import { creditBalance } from "../domain/credits.ts";
import { priceOf, type Price } from "../domain/price-book.ts";
import { checkoutHold, clientHold, releaseHold } from "../domain/holds.ts";
import { currentAddress } from "../domain/profile.ts";
import {
  activeTechnicians,
  availability,
  bookableTypes,
  holdSlot,
  regularTechnician,
  type Moving,
} from "../domain/scheduling.ts";
import { bookableService, serviceOf, type PricedService } from "../domain/services.ts";
import { changeableVisit, changeTerms, type ChangeableVisit, type ChangeTerms } from "../domain/visit-changes.ts";
import { bookableDays } from "../domain/next-visit.ts";
import { clientOf, requireClientSession } from "../http/client-session.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { opsInputs } from "../http/ops-inputs.ts";
import { requireSelfServe } from "../http/self-serve.ts";
import { visitorOf } from "../http/visitor.ts";
import { GIVEN_BY_BOOKING, isFullAddress } from "../policy/booking.ts";
import { LATE_FEES } from "../policy/moving-a-visit.ts";
import { stripStart } from "../policy/next-visit.ts";
import { takesCredit } from "../policy/referral-reward.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";

export const PriceSchema = z
  .object({
    amount_ex_gst: z.number().int().openapi({ description: "In paise, before GST: the main figure." }),
    amount: z.number().int().openapi({ description: "In paise, GST included: what the client pays." }),
    gst_percent: z.number(),
  })
  .strict()
  .openapi("Price");

const TechnicianSchema = z.object({ name: z.string(), initials: z.string() }).strict();

/** A service as a booking names it: its code within its kind, its name, and how long it takes. */
export const ServiceSchema = z
  .object({
    tier: z.string().openapi({ description: "Its code within its kind, which never changes." }),
    name: z.string(),
    minutes: z.number().int().openapi({ description: "How long the visit is booked for." }),
  })
  .strict()
  .openapi("VisitService");

/** A service's code within its kind, as the price book prices it (PRICE_TIER). */
const Tier = z
  .string()
  .regex(PRICE_TIER)
  .optional()
  .openapi({ description: "The service's code within its kind; left out, the kind's standard service while offered." });

const AvailabilitySchema = z
  .object({
    type: z.enum(VISIT_TYPES),
    service: ServiceSchema.openapi({ description: "The service the windows are for: a move's is its visit's." }),
    price: PriceSchema.openapi({ description: "The first day's price." }),
    regular: z.union([TechnicianSchema, z.null()]).openapi({ description: "Whoever did the client's latest visit." }),
    days: z.array(
      z
        .object({
          date: z.iso.date(),
          price: PriceSchema.openapi({ description: "What a visit on this day costs: a price changes from its date." }),
          windows: z.array(
            z
              .object({
                window: z.enum(BOOKING_WINDOWS),
                with: z
                  .union([z.enum(["regular", "another"]), z.null()])
                  .openapi({ description: "Who would come: the regular technician, another, or nobody (full)." }),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict()
  .openapi("Availability");

const HoldSchema = z
  .object({
    id: z.uuid(),
    type: z.enum(VISIT_TYPES),
    service: ServiceSchema.openapi({ description: "What it is for, with the length it is held and booked for." }),
    date: z.iso.date(),
    window: z.enum(BOOKING_WINDOWS),
    starts_at: z.iso.datetime(),
    ends_at: z.iso.datetime(),
    technician: TechnicianSchema,
    price: PriceSchema,
    late_fee: z
      .union([PriceSchema, z.null()])
      .openapi({ description: "What moving it inside 24 hours costs: a first fit's or a replacement's late fee." }),
    free_until: z.iso.datetime().openapi({ description: "Until then, moving or cancelling is free." }),
    expires_at: z.iso.datetime(),
    state: z.enum(["held", "expired", "booked", "released"]),
    paid: z.boolean().openapi({ description: "Razorpay has confirmed the payment; the visit is being booked." }),
    visit_id: z.union([z.uuid(), z.null()]).openapi({ description: "The visit it became, once booked." }),
    moves_visit_id: z
      .union([z.uuid(), z.null()])
      .openapi({ description: "The visit this hold moves; null for a new booking." }),
    credit: z
      .union([
        z
          .object({ remaining: z.number().int().openapi({ description: "Credits left once this one is used." }) })
          .strict(),
        z.null(),
      ])
      .openapi({ description: "A service-visit credit covers it, so payment is skipped (board C5)." }),
  })
  .strict()
  .openapi("Hold");

export const BookingSchema = z
  .object({
    hold_id: z.uuid(),
    checkout: z
      .union([
        z
          .object({
            key_id: z.string(),
            order_id: z.string(),
            amount: z.number().int(),
            currency: z.literal("INR"),
            name: z.string(),
            description: z.string(),
            prefill: z.object({ name: z.string(), contact: z.string() }).strict(),
          })
          .strict(),
        z.null(),
      ])
      .openapi({ description: "What Razorpay Checkout opens with; null for a free visit, booked without paying." }),
  })
  .strict()
  .openapi("Booking");

const availabilityRoute = createRoute({
  method: "get",
  path: "/api/availability",
  summary: "The windows open for a service over 14 days",
  request: {
    query: z.object({
      type: z.enum(VISIT_TYPES),
      tier: Tier,
      from: z.iso
        .date()
        .optional()
        .openapi({
          description:
            "The first day; the first bookable day if left out, or if earlier. The 14 days end within how far ahead a " +
            "visit may be booked, and a day outside it, or before a first fit may be booked, has no window open.",
        }),
      moving: z.uuid().optional().openapi({ description: "One of the client's visits, to move: its own type." }),
    }),
  },
  responses: {
    200: { description: "Each day's three windows", content: { "application/json": { schema: AvailabilitySchema } } },
    401: errorResponse("session_required"),
    409: errorResponse("ops_assisted: self-serve booking is off; or not_changeable: the visit can no longer be moved"),
    422: errorResponse("not_bookable: the client may not book this kind of visit, or the service is not offered"),
  },
});

const holdRoute = createRoute({
  method: "post",
  path: "/api/holds",
  summary: "Hold a window for ten minutes while the client pays",
  request: {
    body: {
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
    422: errorResponse("not_bookable: this kind of visit, this service, or that day, is not open to the client"),
  },
});

const holdByIdRoute = createRoute({
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
          "decided on (ADR 0080); left out, none.",
      }),
  })
  .strict()
  .openapi("BookingStart");

const bookingRoute = createRoute({
  method: "post",
  path: "/api/bookings",
  summary: "Book a held window: pay through Checkout, or, if free, book it at once",
  request: { body: { content: { "application/json": { schema: BookingStartSchema } } } },
  responses: {
    201: { description: "Started", content: { "application/json": { schema: BookingSchema } } },
    401: errorResponse("session_required"),
    409: errorResponse("hold_expired: the hold lapsed, was let go, or is booked already; or ops_assisted"),
  },
});

const releaseRoute = createRoute({
  method: "delete",
  path: "/api/holds/{id}",
  summary: "Let a hold go",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    204: { description: "Let go, or already gone" },
    401: errorResponse("session_required"),
    409: errorResponse("ops_assisted"),
  },
});

/** The days this client may book a visit of this type on, by the figures ops set (src/domain/next-visit.ts). */
const rangeFor = async (c: Context<AppEnv>, personId: string, type: VisitType) =>
  bookableDays(c.env.DB, personId, type, c.var.deps.now(), (await opsInputs(c)).nextVisitDays);

/**
 * The service a client may book, offered that day with its price then: of a kind they may book now, the tier named,
 * or the kind's standard one where they name none. Null when they may not.
 */
async function bookable(
  c: Context<AppEnv>,
  personId: string,
  wanted: { readonly type: VisitType; readonly tier: string | undefined },
  on: string,
): Promise<PricedService | null> {
  const db = c.env.DB;
  if (!(await bookableTypes(db, personId)).includes(wanted.type)) return null;
  return bookableService(db, wanted.type, wanted.tier, on);
}

/** A moved visit's own service, by its name as it is now, with the length the visit keeps. */
async function movedService(c: Context<AppEnv>, visit: ChangeableVisit) {
  const service = await serviceOf(c.env.DB, visit.type, visit.tier);
  return { tier: visit.tier, name: service?.name ?? FSM_SERVICE_NAMES[visit.type], minutes: visit.minutes };
}

/** A service as the API names it. */
const serviceBody = (service: { readonly tier: string; readonly name: string; readonly minutes: number }) => ({
  tier: service.tier,
  name: service.name,
  minutes: service.minutes,
});

/**
 * The terms for moving one of the client's visits of this type now, and the visit as a move sees it; null if it
 * can no longer be moved in the app. A visit FSM has no technician for yet is ops' to move.
 */
export async function moveTermsFor(
  c: Context<AppEnv>,
  personId: string,
  visitId: string,
  type: VisitType | null,
  on?: string,
): Promise<{ terms: ChangeTerms; moving: Moving } | null> {
  const now = c.var.deps.now();
  const visit = await changeableVisit(c.env.DB, personId, visitId, now);
  if (visit === null || (type !== null && visit.type !== type) || visit.technicianId === null) return null;
  return {
    terms: await changeTerms(c.env.DB, visit, now, on),
    moving: { visitId: visit.id, technicianId: visit.technicianId },
  };
}

/** Starts paying for a live hold: what Checkout opens with, or null for one that is free and on its way to FSM. */
export async function startCheckout(c: Context<AppEnv>, holdId: string, personId: string) {
  const { deps, requestId } = c.var;
  const started = await startBooking(c.env.DB, deps.payments, holdId, personId, deps.now());
  if (started === null) return null;
  if (started.kind === "free") {
    await c.env.FSM_QUEUE.send({ hold_id: holdId, request_id: requestId } satisfies FsmSyncMessage);
    return { hold_id: holdId, checkout: null };
  }
  const row = await checkoutHold(c.env.DB, holdId);
  if (row === null) return null;
  const name = row.service_name ?? FSM_SERVICE_NAMES[row.type];
  const description =
    row.move_kind === "move" ? `Moving your ${name.toLowerCase()} to ${row.date}` : `${name}, ${row.date}`;
  return {
    hold_id: holdId,
    checkout: {
      key_id: c.var.config.settings.razorpay?.keyId ?? "",
      order_id: started.orderId,
      amount: row.amount,
      currency: "INR" as const,
      name: "Mane Man",
      description,
      prefill: { name: row.name, contact: row.mobile_e164 },
    },
  };
}

export function registerClientBooking(app: App): void {
  for (const path of ["/api/availability", "/api/holds", "/api/holds/*", "/api/bookings"]) {
    app.use(path, requireClientSession);
    app.use(path, requireSelfServe);
  }

  app.openapi(availabilityRoute, async (c) => {
    const session = clientOf(c);
    const { type, tier, from, moving: movingId } = c.req.valid("query");
    const now = c.var.deps.now();
    const range = await rangeFor(c, session.subjectId, type);
    const start = stripStart(from, range, BOOKING_DAYS);
    const move = movingId === undefined ? null : await moveTermsFor(c, session.subjectId, movingId, type, start);
    if (movingId !== undefined && move === null) return c.json(errorBody("not_changeable", c.var.requestId), 409);
    const offered = move === null ? await bookable(c, session.subjectId, { type, tier }, start) : null;
    const service = move === null ? offered : await movedService(c, move.terms.visit);
    const price = move === null ? (offered?.price ?? null) : move.terms.move.price;
    if (service === null || price === null) return c.json(errorBody("not_bookable", c.var.requestId), 422);
    const db = c.env.DB;
    // A move in place keeps the visit's technician; a charged move books a new visit with anyone.
    const moving = move === null || move.terms.move.cost === "charged" ? null : move.moving;
    const until = offered?.retired_date ?? null;
    const [days, regularId, technicians] = await Promise.all([
      availability(db, session.subjectId, { minutes: service.minutes, until }, start, BOOKING_DAYS, now, moving),
      moving === null ? regularTechnician(db, session.subjectId) : moving.technicianId,
      activeTechnicians(db),
    ]);
    // A free or late-fee move costs the same whichever day it goes to; a new visit costs that day's price.
    const priceOn = async (date: string): Promise<Price> => {
      if (move !== null && move.terms.move.cost !== "charged") return price;
      return (await priceOf(db, type, date, service.tier)) ?? price;
    };
    const regular = technicians.find((technician) => technician.id === regularId);
    // A day before the bookable days open, or past the last, is offered to nobody.
    const strip = days.map((day) =>
      day.date < range.opens || day.date > range.last
        ? { ...day, windows: day.windows.map((each) => ({ ...each, with: null })) }
        : day,
    );
    return c.json(
      {
        type,
        service: serviceBody(service),
        price,
        regular: regular === undefined ? null : { name: regular.name, initials: regular.initials },
        days: await Promise.all(strip.map(async (day) => ({ ...day, price: await priceOn(day.date) }))),
      },
      200,
    );
  });

  app.openapi(holdRoute, async (c) => {
    const session = clientOf(c);
    const { type, tier, date, window, moving: movingId } = c.req.valid("json");
    const now = c.var.deps.now();
    const move = movingId === undefined ? null : await moveTermsFor(c, session.subjectId, movingId, type, date);
    if (movingId !== undefined && move === null) return c.json(errorBody("not_changeable", c.var.requestId), 409);
    const offered = move === null ? await bookable(c, session.subjectId, { type, tier }, date) : null;
    const service = move === null ? offered : await movedService(c, move.terms.visit);
    const price = move === null ? (offered?.price ?? null) : move.terms.move.price;
    const { opens, last } = await rangeFor(c, session.subjectId, type);
    if (service === null || price === null || date < opens || date > last) {
      return c.json(errorBody("not_bookable", c.var.requestId), 422);
    }
    const address = await currentAddress(c.env.DB, session.subjectId);
    if (!isFullAddress(address)) return c.json(errorBody("address_required", c.var.requestId), 409);
    const moves =
      move === null
        ? undefined
        : { visit: move.moving, kind: move.terms.move.cost === "charged" ? ("replace" as const) : ("move" as const) };
    const useCredit =
      takesCredit(type, moves?.kind ?? null) && (await creditBalance(c.env.DB, session.subjectId, now)).visits > 0;
    const lateFeeItem = LATE_FEES[type];
    const hold = await holdSlot(
      c.env.DB,
      {
        personId: session.subjectId,
        service: { type, tier: service.tier, minutes: service.minutes },
        date,
        window,
        price,
        lateFee: lateFeeItem === undefined ? null : await priceOf(c.env.DB, lateFeeItem, date),
        pincode: address.pincode,
        useCredit,
        from: "app",
        ...(moves === undefined ? {} : { moves }),
      },
      now,
      HOLD_SECONDS,
    );
    if (hold === null) return c.json(errorBody("taken", c.var.requestId), 409);
    c.var.log.info("slot_held", { hold_id: hold.id, type, tier: service.tier, date, window });
    const held = await clientHold(c.env.DB, hold.id, session.subjectId, now);
    if (held === null) return c.json(errorBody("taken", c.var.requestId), 409);
    return c.json(held, 201);
  });

  app.openapi(holdByIdRoute, async (c) => {
    const session = clientOf(c);
    const held = await clientHold(c.env.DB, c.req.valid("param").id, session.subjectId, c.var.deps.now());
    if (held === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    return c.json(held, 200);
  });

  app.openapi(bookingRoute, async (c) => {
    const session = clientOf(c);
    const { hold_id: holdId, consents = [] } = c.req.valid("json");
    const booking = await startCheckout(c, holdId, session.subjectId);
    if (booking === null) return c.json(errorBody("hold_expired", c.var.requestId), 409);
    await recordBookingConsents(c.env.DB, {
      personId: session.subjectId,
      holdId,
      shown: consents,
      ipHash: (await visitorOf(c)).ipHash,
      requestId: c.var.requestId,
      now: c.var.deps.now(),
    });
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
