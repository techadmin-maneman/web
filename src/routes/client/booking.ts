// Booking in the app (docs/decisions/0045-self-serve-booking.md): the windows open for a service, one held for ten
// minutes while the client pays, and its booking. With self-serve booking off, every route answers ops_assisted. No
// window is held before the client has given the visit's address, and with `moving` a hold moves one of their visits.
//
//   GET    /api/availability?type=&tier=&from=   14 days of the windows the visit can start in, and who could come
//   POST   /api/holds                      hold a window
//   GET    /api/holds/:id                  a hold: lapsed, paid, or booked as a visit
//   DELETE /api/holds/:id                  let it go
//   POST   /api/bookings                   book a hold: Checkout's order, or, if free, sent to be booked

import { selfServeRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../../http/context.ts";
import { BOOKING_DAYS, BOOKING_WINDOWS } from "../../config/scheduling.ts";
import { VISIT_TYPE_NAMES, VISIT_TYPES, type VisitType } from "../../config/visit-types.ts";
import { keepShownConsents, recordBookingConsents } from "../../domain/booking-consents.ts";
import { codeToCarry } from "../../domain/discount-code-uses.ts";
import { spendableCredits } from "../../domain/credits.ts";
import { lateFeeOn, priceOf, type Price } from "../../domain/price-book.ts";
import { clientHold, releaseHold } from "../../domain/holds.ts";
import { currentAddress } from "../../domain/profile.ts";
import { isServed } from "../../domain/service-area.ts";
import { availability, bookableTypes } from "../../domain/availability.ts";
import { holdSlot } from "../../domain/hold-slot.ts";
import { bookableService, offeredProducts, serviceOf, type PricedService } from "../../domain/services.ts";
import { loadSlotSchedule } from "../../domain/slot-times.ts";
import { windowTimesOf } from "../../policy/slot-times.ts";
import { termsInForce, type ChangeableVisit, type ChangeTerms } from "../../domain/visit-changes.ts";
import { bookableDays } from "../../domain/next-visit.ts";
import type { OpsInputs } from "../../domain/ops-settings.ts";
import { moveTermsFor, startCheckout } from "../../http/client-booking.ts";
import { clientOf } from "../../http/client-session.ts";
import { errorBody, errorResponse, refuse } from "../../http/errors.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { visitorOf } from "../../http/visitor.ts";
import { GIVEN_BY_BOOKING, isFullAddress } from "../../policy/booking.ts";
import { indiaInstant } from "../../lib/india-time.ts";
import { changeChargedOnBooking, CHARGES, LATE_FEES, type SoldTerms } from "../../policy/moving-a-visit.ts";
import { stripStart } from "../../policy/next-visit.ts";
import { takesCredit } from "../../policy/referral-reward.ts";
import { PRICE_TIER } from "../../policy/services.ts";

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

/** A service's code within its kind, as the price book prices it (PRICE_TIER, src/policy/services.ts). */
const Tier = z
  .string()
  .regex(PRICE_TIER)
  .optional()
  .openapi({
    description:
      "The service's code within its kind; left out, the kind's standard service while offered. A first fit has " +
      "none: it names the hair system.",
  });

const AvailabilitySchema = z
  .object({
    type: z.enum(VISIT_TYPES),
    service: ServiceSchema.openapi({ description: "The service the windows are for: a move's is its visit's." }),
    price: PriceSchema.openapi({ description: "The first day's price." }),
    change_notice_hours: z.number().int().openapi({
      description: "The notice a visit booked here is sold under: a move keeps its visit's own, else as ops set it.",
    }),
    last: z.iso
      .date()
      .openapi({ description: "The last day this visit may be booked on: later days are asked for up to it." }),
    days: z.array(
      z
        .object({
          date: z.iso.date(),
          price: PriceSchema.openapi({ description: "What a visit on this day costs: a price changes from its date." }),
          windows: z.array(
            z
              .object({
                window: z.enum(BOOKING_WINDOWS),
                start: z
                  .string()
                  .openapi({ description: "When the window starts that day, in India's time, as 12:00." }),
                end: z.string().openapi({ description: "When it ends that day: ops set the day's times from a date." }),
                open: z.boolean().openapi({
                  description:
                    "Whether a technician is free to take it: never the one who took the client's visit just " +
                    "before or just after it. False when full.",
                }),
                change_charged: z.boolean().openapi({
                  description:
                    "Booked now, moving or cancelling it would already cost the client: it starts inside the notice, " +
                    "and its kind is charged there.",
                }),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict()
  .openapi("Availability");

export const HoldSchema = z
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
    late_fee: z.union([PriceSchema, z.null()]).openapi({
      description: "The late fee moving it inside the notice costs, where it is sold to charge one; else null.",
    }),
    free_until: z.iso.datetime().openapi({ description: "Until then, moving or cancelling is free." }),
    change_notice_hours: z
      .number()
      .int()
      .openapi({
        description:
          "The notice it is sold under: how many hours before its window moving or cancelling stops being free, as " +
          "ops set it when the hold was made (24 to begin with).",
      }),
    late_change_charge: z.enum(CHARGES).openapi({
      description:
        "What moving or cancelling it inside the notice costs, as it is sold: nothing, its late fee (late_fee), or " +
        "the visit itself, whose payment is kept or whose credit is spent (visit).",
    }),
    expires_at: z.iso.datetime(),
    pay_by: z.iso.datetime().openapi({
      description:
        "The last moment a payment counts as made in time: expires_at and the grace after it. Checkout closes then.",
    }),
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
      .openapi({ description: "A service-visit credit covers it, so payment is skipped." }),
    discount: z
      .union([
        z
          .object({
            code: z.string(),
            amount_ex_gst: z.union([z.number().int(), z.null()]).openapi({
              description: "In paise: what the code takes off before GST; null until the price it comes off is known.",
            }),
            list_price: z
              .union([PriceSchema, z.null()])
              .openapi({ description: "The price before the code; price is what is left, with GST on it." }),
          })
          .strict(),
        z.null(),
      ])
      .openapi({ description: "The discount code entered on it (docs/decisions/0108-discount-codes.md); else null." }),
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

const availabilityRoute = selfServeRoute({
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
    422: errorResponse(
      "not_bookable: the client may not book this kind of visit, or the service is not offered; no_product: a first " +
        "fit, on a day the console offers no hair system; not_served: the client's address is in a pincode we do not " +
        "come to",
    ),
  },
});

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

/** The days this client may book a visit of this type on, by the figures ops set (src/domain/next-visit.ts). */
const rangeFor = async (c: Context<AppEnv>, personId: string, type: VisitType) =>
  bookableDays(c.env.DB, personId, type, c.var.deps.now(), (await opsInputs(c)).nextVisitDays);

/**
 * The service a client may book, offered that day with its price then: of a kind they may book now, the tier named,
 * or the kind's standard one where they name none. Else why not: no_product for a first fit on a day the console
 * offers no hair system, not_bookable for anything else.
 */
async function bookable(
  c: Context<AppEnv>,
  personId: string,
  wanted: { readonly type: VisitType; readonly tier: string | undefined },
  on: string,
): Promise<PricedService | "no_product" | "not_bookable"> {
  const db = c.env.DB;
  const [types, service] = await Promise.all([
    bookableTypes(db, personId),
    bookableService(db, wanted.type, wanted.tier, on),
  ]);
  if (!types.includes(wanted.type)) return "not_bookable";
  if (service !== null) return service;
  const noProduct = wanted.type === "first_fit" && (await offeredProducts(db, on)).length === 0;
  return noProduct ? "no_product" : "not_bookable";
}

/** Whether the client's address is in a pincode we do not come to; false while they have given none. */
async function addressOutsideArea(db: D1Database, personId: string): Promise<boolean> {
  const address = await currentAddress(db, personId);
  if (address === null) return false;
  return !(await isServed(db, address.pincode));
}

/** A moved visit's own service, by its name as it is now, with the length the visit keeps. */
async function movedService(c: Context<AppEnv>, visit: ChangeableVisit) {
  const service = await serviceOf(c.env.DB, visit.type, visit.tier);
  return { tier: visit.tier, name: service?.name ?? VISIT_TYPE_NAMES[visit.type], minutes: visit.minutes };
}

/** A service as the API names it. */
const serviceBody = (service: { readonly tier: string; readonly name: string; readonly minutes: number }) => ({
  tier: service.tier,
  name: service.name,
  minutes: service.minutes,
});

/**
 * What a hold is sold under: a move in place carries the moved visit's own terms and late fee to its new time, since
 * it is the same visit, sold once; any other hold, a new booking or a charged move's new visit, is sold under the
 * terms in force and its kind's late fee on its day (docs/decisions/0088-every-policy-in-the-console.md).
 */
async function soldAs(
  c: Context<AppEnv>,
  hold: { type: VisitType; date: string; move: ChangeTerms | null; kind: "move" | "replace" | null },
  inputs: OpsInputs,
): Promise<{ terms: SoldTerms; lateFee: Price | null }> {
  if (hold.move !== null && hold.kind === "move") return { terms: hold.move.sold, lateFee: hold.move.lateFee };
  const lateFeeItem = LATE_FEES[hold.type];
  return {
    terms: termsInForce(inputs, hold.type),
    lateFee: lateFeeItem === undefined ? null : await lateFeeOn(c.env.DB, lateFeeItem, hold.date),
  };
}

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
  app.openapi(availabilityRoute, async (c) => {
    const session = clientOf(c);
    const { type, tier, from, moving: movingId } = c.req.valid("query");
    const now = c.var.deps.now();
    const range = await rangeFor(c, session.subjectId, type);
    const start = stripStart(from, range, BOOKING_DAYS);
    const move = movingId === undefined ? null : await moveTermsFor(c, session.subjectId, movingId, type, start);
    if (movingId !== undefined && move === null) return refuse(c, "not_changeable");
    const offered = move === null ? await bookable(c, session.subjectId, { type, tier }, start) : null;
    if (typeof offered === "string") return c.json(errorBody(offered, c.var.requestId), 422);
    const service = move === null ? offered : await movedService(c, move.terms.visit);
    const price = move === null ? (offered?.price ?? null) : move.terms.move.price;
    if (service === null || price === null) return refuse(c, "not_bookable");
    const db = c.env.DB;
    if (await addressOutsideArea(db, session.subjectId)) return refuse(c, "not_served");
    // A move in place keeps the visit's technician; a charged move books a new visit with anyone.
    const moving = move === null || move.terms.move.cost === "charged" ? null : move.moving;
    // A move in place keeps its visit's terms, as its hold will (soldAs); anything else is sold under those in force.
    const terms = move !== null && moving !== null ? move.terms.sold : termsInForce(await opsInputs(c), type);
    const until = offered?.retired_date ?? null;
    // A charged move books a new visit in place of the old, which stands beside it no longer.
    const placing = { personId: session.subjectId, moving, replacing: move?.moving.visitId ?? null, ownUnpaid: true };
    const [days, schedule] = await Promise.all([
      availability(db, placing, { minutes: service.minutes, until }, start, BOOKING_DAYS, now),
      loadSlotSchedule(db),
    ]);
    // A free or late-fee move costs the same whichever day it goes to; a new visit costs that day's price.
    const priceOn = async (date: string): Promise<Price> => {
      if (move !== null && move.terms.move.cost !== "charged") return price;
      return (await priceOf(db, type, date, service.tier)) ?? price;
    };
    // A day before the bookable days open, or past the last, is offered to nobody. Each window says its hours that day,
    // and whether a visit booked in it now would already cost the client to change.
    const strip = days.map((day) => {
      const hours = windowTimesOf(schedule.on(day.date));
      const shut = day.date < range.opens || day.date > range.last;
      const windows = day.windows.map((each) => {
        const times = hours[each.window];
        const changeCharged = changeChargedOnBooking(indiaInstant(day.date, times.start), now, terms);
        return { ...each, ...times, open: !shut && each.open, change_charged: changeCharged };
      });
      return { ...day, windows };
    });
    return c.json(
      {
        type,
        service: serviceBody(service),
        price,
        change_notice_hours: terms.noticeHours,
        last: range.last,
        days: await Promise.all(strip.map(async (day) => ({ ...day, price: await priceOn(day.date) }))),
      },
      200,
    );
  });

  app.openapi(holdRoute, async (c) => {
    const personId = clientOf(c).subjectId;
    const { type, tier, date, window, moving: movingId } = c.req.valid("json");
    const now = c.var.deps.now();
    // Each read is a trip to D1 and back, so the reads that need nothing from each other go together.
    const [move, offered, range, address, inputs] = await Promise.all([
      movingId === undefined ? null : moveTermsFor(c, personId, movingId, type, date),
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
    const [service, sold, useCredit, served] = await Promise.all([
      move === null ? offered : movedService(c, move.terms.visit),
      soldAs(c, { type, date, move: move?.terms ?? null, kind: moveKind }, inputs),
      creditPays(c.env.DB, { personId, type, moveKind }, now),
      isFullAddress(address) ? isServed(c.env.DB, address.pincode) : false,
    ]);
    const price = move === null ? (offered?.price ?? null) : move.terms.move.price;
    if (service === null || price === null || date < range.opens || date > range.last) {
      return refuse(c, "not_bookable");
    }
    if (!isFullAddress(address)) return refuse(c, "address_required");
    if (!served) return refuse(c, "not_served");
    // A visit moved late books a new one in its place, which keeps the visit's discount code, unless a credit pays it
    // (docs/decisions/0108-discount-codes.md).
    const carried =
      moves?.kind === "replace" && !useCredit ? await codeToCarry(c.env.DB, moves.visit.visitId, price, now) : null;
    const hold = await holdSlot(
      c.env.DB,
      {
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
      inputs.paymentHold.countdown * 60,
      inputs.paymentHold.grace * 60,
    );
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
