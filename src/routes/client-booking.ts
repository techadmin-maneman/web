// Booking in the app (docs/decisions/0045-self-serve-booking.md): the days and
// windows open for a kind of visit (board C2 and C3), and a window held for ten
// minutes while the client pays (C4). Behind SELF_SERVE_BOOKING: off, every
// route answers 409 ops_assisted and the app opens WhatsApp to ops instead.
//
//   GET    /api/availability?type=&from=   14 days of three windows, and who could come
//   POST   /api/holds                      hold a window
//   GET    /api/holds/:id                  a hold: lapsed, paid, or booked as a visit
//   DELETE /api/holds/:id                  let it go
//   POST   /api/bookings                   book a hold: Checkout's order, or, if free, straight to FSM

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../app.ts";
import { BOOKING_DAYS, BOOKING_WINDOWS, HOLD_SECONDS, WINDOW_TIMES } from "../config/scheduling.ts";
import { FSM_SERVICE_NAMES, VISIT_TYPES, type VisitType } from "../config/visit-types.ts";
import { startBooking } from "../domain/bookings.ts";
import { priceOf, type Price, type PriceItem } from "../domain/price-book.ts";
import {
  activeTechnicians,
  availability,
  bookableTypes,
  holdSlot,
  regularTechnician,
  visitTimes,
} from "../domain/scheduling.ts";
import { requireClientSession } from "../http/client-session.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { addDays, indiaDate, indiaInstant } from "../lib/india-time.ts";
import { FREE_CHANGE_NOTICE_HOURS } from "../policy/moving-a-visit.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";

const PriceSchema = z
  .object({
    amount_ex_gst: z.number().int().openapi({ description: "In paise, before GST: the main figure." }),
    amount: z.number().int().openapi({ description: "In paise, GST included: what the client pays." }),
    gst_percent: z.number(),
  })
  .strict()
  .openapi("Price");

const TechnicianSchema = z.object({ name: z.string(), initials: z.string() }).strict();

const AvailabilitySchema = z
  .object({
    type: z.enum(VISIT_TYPES),
    price: PriceSchema,
    regular: z.union([TechnicianSchema, z.null()]).openapi({ description: "Whoever did the client's latest visit." }),
    days: z.array(
      z
        .object({
          date: z.iso.date(),
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
  })
  .strict()
  .openapi("Hold");

const BookingSchema = z
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
  summary: "The windows open for a kind of visit over 14 days",
  request: {
    query: z.object({
      type: z.enum(VISIT_TYPES),
      from: z.iso.date().optional().openapi({ description: "The first day; tomorrow if left out, or if earlier." }),
    }),
  },
  responses: {
    200: { description: "Each day's three windows", content: { "application/json": { schema: AvailabilitySchema } } },
    401: errorResponse("session_required"),
    409: errorResponse("ops_assisted: self-serve booking is off"),
    422: errorResponse("not_bookable: the client may not book this kind of visit"),
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
          schema: z.object({ type: z.enum(VISIT_TYPES), date: z.iso.date(), window: z.enum(BOOKING_WINDOWS) }).strict(),
        },
      },
    },
  },
  responses: {
    201: { description: "Held", content: { "application/json": { schema: HoldSchema } } },
    401: errorResponse("session_required"),
    409: errorResponse("taken: nobody is free in that window now; or ops_assisted"),
    422: errorResponse("not_bookable: this kind of visit, or that day, is not open to the client"),
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

const bookingRoute = createRoute({
  method: "post",
  path: "/api/bookings",
  summary: "Book a held window: pay through Checkout, or, if free, book it at once",
  request: { body: { content: { "application/json": { schema: z.object({ hold_id: z.uuid() }).strict() } } } },
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

/** The late fee for moving a visit of this type inside 24 hours, if it has one. */
const LATE_FEES: Partial<Record<VisitType, PriceItem>> = {
  first_fit: "late_fee_first_fit",
  replacement: "late_fee_replacement",
};

interface HoldRow {
  id: string;
  type: VisitType;
  date: string;
  window_label: (typeof BOOKING_WINDOWS)[number];
  start_unit: number;
  amount: number;
  amount_ex_gst: number;
  gst_percent: number;
  state: "held" | "booked" | "released";
  expires_at: string;
  technician_name: string;
  technician_initials: string;
  appointment_id: string | null;
  paid: number;
}

async function holdOf(db: D1Database, row: HoldRow, now: Date) {
  const { start, end } = visitTimes(row.date, row.start_unit, row.type);
  const windowStarts = indiaInstant(row.date, WINDOW_TIMES[row.window_label].start);
  const lateFee = LATE_FEES[row.type];
  return {
    id: row.id,
    type: row.type,
    date: row.date,
    window: row.window_label,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    technician: { name: row.technician_name, initials: row.technician_initials },
    price: { amount_ex_gst: row.amount_ex_gst, amount: row.amount, gst_percent: row.gst_percent },
    late_fee: lateFee === undefined ? null : await priceOf(db, lateFee, row.date),
    free_until: new Date(windowStarts.getTime() - FREE_CHANGE_NOTICE_HOURS * 3_600_000).toISOString(),
    expires_at: row.expires_at,
    state: row.state === "held" && row.expires_at <= now.toISOString() ? ("expired" as const) : row.state,
    paid: row.paid === 1,
    visit_id: row.appointment_id,
  };
}

const HOLD_QUERY = `SELECT h.id, h.type, h.date, h.window_label, h.start_unit, h.amount, h.amount_ex_gst, h.gst_percent,
    h.state, h.expires_at, t.name AS technician_name, t.initials AS technician_initials, h.appointment_id,
    EXISTS (SELECT 1 FROM payments p WHERE p.razorpay_order_id = h.razorpay_order_id AND p.status = 'captured') AS paid
  FROM slot_holds h JOIN technicians t ON t.id = h.technician_id WHERE h.id = ?1 AND h.person_id = ?2`;

/** The first day a client may book: tomorrow, in India. */
const firstBookableDay = (now: Date) => addDays(indiaDate(now), 1);

/** Whether a client may book this kind of visit, and its price on that day. */
async function bookable(c: Context<AppEnv>, personId: string, type: VisitType, on: string): Promise<Price | null> {
  const db = c.env.DB;
  if (!(await bookableTypes(db, personId)).includes(type)) return null;
  return priceOf(db, type, on);
}

export function registerClientBooking(app: App): void {
  for (const path of ["/api/availability", "/api/holds", "/api/holds/*", "/api/bookings"]) {
    app.use(path, requireClientSession);
    app.use(path, async (c, next) => {
      if (!c.var.config.settings.selfServeBooking) return c.json(errorBody("ops_assisted", c.var.requestId), 409);
      return next();
    });
  }

  app.openapi(availabilityRoute, async (c) => {
    const session = c.var.clientSession;
    if (session === undefined) return c.json(errorBody("session_required", c.var.requestId), 401);
    const { type, from } = c.req.valid("query");
    const now = c.var.deps.now();
    const first = firstBookableDay(now);
    const start = from === undefined || from < first ? first : from;
    const price = await bookable(c, session.subjectId, type, start);
    if (price === null) return c.json(errorBody("not_bookable", c.var.requestId), 422);
    const db = c.env.DB;
    const [days, regularId, technicians] = await Promise.all([
      availability(db, session.subjectId, type, start, BOOKING_DAYS, now),
      regularTechnician(db, session.subjectId),
      activeTechnicians(db),
    ]);
    const regular = technicians.find((technician) => technician.id === regularId);
    return c.json(
      {
        type,
        price,
        regular: regular === undefined ? null : { name: regular.name, initials: regular.initials },
        days,
      },
      200,
    );
  });

  app.openapi(holdRoute, async (c) => {
    const session = c.var.clientSession;
    if (session === undefined) return c.json(errorBody("session_required", c.var.requestId), 401);
    const { type, date, window } = c.req.valid("json");
    const now = c.var.deps.now();
    const first = firstBookableDay(now);
    const price = await bookable(c, session.subjectId, type, date);
    if (price === null || date < first || date > addDays(first, BOOKING_DAYS - 1)) {
      return c.json(errorBody("not_bookable", c.var.requestId), 422);
    }
    const hold = await holdSlot(
      c.env.DB,
      { personId: session.subjectId, type, date, window, price },
      now,
      HOLD_SECONDS,
    );
    if (hold === null) return c.json(errorBody("taken", c.var.requestId), 409);
    c.var.log.info("slot_held", { hold_id: hold.id, type, date, window });
    const row = await c.env.DB.prepare(HOLD_QUERY).bind(hold.id, session.subjectId).first<HoldRow>();
    if (row === null) return c.json(errorBody("taken", c.var.requestId), 409);
    return c.json(await holdOf(c.env.DB, row, now), 201);
  });

  app.openapi(holdByIdRoute, async (c) => {
    const session = c.var.clientSession;
    if (session === undefined) return c.json(errorBody("session_required", c.var.requestId), 401);
    const row = await c.env.DB.prepare(HOLD_QUERY).bind(c.req.valid("param").id, session.subjectId).first<HoldRow>();
    if (row === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    return c.json(await holdOf(c.env.DB, row, c.var.deps.now()), 200);
  });

  app.openapi(bookingRoute, async (c) => {
    const session = c.var.clientSession;
    if (session === undefined) return c.json(errorBody("session_required", c.var.requestId), 401);
    const holdId = c.req.valid("json").hold_id;
    const { deps, requestId } = c.var;
    const started = await startBooking(c.env.DB, deps.payments, holdId, session.subjectId, deps.now());
    if (started === null) return c.json(errorBody("hold_expired", requestId), 409);
    if (started.kind === "free") {
      await c.env.FSM_QUEUE.send({ hold_id: holdId, request_id: requestId } satisfies FsmSyncMessage);
      return c.json({ hold_id: holdId, checkout: null }, 201);
    }
    const row = await c.env.DB.prepare(
      `SELECT h.type, h.amount, h.date, p.name, p.mobile_e164 FROM slot_holds h JOIN people p ON p.id = h.person_id
       WHERE h.id = ?1`,
    )
      .bind(holdId)
      .first<{ type: VisitType; amount: number; date: string; name: string; mobile_e164: string }>();
    if (row === null) return c.json(errorBody("hold_expired", requestId), 409);
    return c.json(
      {
        hold_id: holdId,
        checkout: {
          key_id: c.var.config.settings.razorpay?.keyId ?? "",
          order_id: started.orderId,
          amount: row.amount,
          currency: "INR" as const,
          name: "Mane Man",
          description: `${FSM_SERVICE_NAMES[row.type]}, ${row.date}`,
          prefill: { name: row.name, contact: row.mobile_e164 },
        },
      },
      201,
    );
  });

  app.openapi(releaseRoute, async (c) => {
    const session = c.var.clientSession;
    if (session === undefined) return c.json(errorBody("session_required", c.var.requestId), 401);
    const db = c.env.DB;
    const id = c.req.valid("param").id;
    const at = c.var.deps.now().toISOString();
    const mine = "SELECT id FROM slot_holds WHERE id = ?1 AND person_id = ?2 AND state = 'held'";
    await db.batch([
      db.prepare(`DELETE FROM slot_claims WHERE hold_id IN (${mine})`).bind(id, session.subjectId),
      db
        .prepare(`UPDATE slot_holds SET state = 'released', updated_at = ?3 WHERE id IN (${mine})`)
        .bind(id, session.subjectId, at),
    ]);
    return c.body(null, 204);
  });
}
