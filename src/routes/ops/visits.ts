// Booking a visit for a client from the console (src/domain/visit-booking.ts), on the ops surface behind Access:
//
//   GET  /api/visits/availability   a client's 14 days of windows for a kind of visit, who is free in each, the kind's
//                                   services, and how the visit would be paid
//   POST /api/visits                book it: at once when nothing is paid at booking, else a payment link goes out
//
// Both keep to the caller's cities: a client elsewhere is not found, and only the technicians there are offered. The
// booking is audited in the batch that holds its slot (ADR 0031).

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { BOOKING_DAYS, BOOKING_WINDOWS } from "../../config/scheduling.ts";
import { VISIT_TYPES } from "../../config/visit-types.ts";
import { auditStatement } from "../../domain/audit.ts";
import { confirmUnpaid, giveBack } from "../../domain/bookings.ts";
import { spendableCredits } from "../../domain/credits.ts";
import type { Hold } from "../../domain/scheduling.ts";
import { freeTechnicians } from "../../domain/scheduling.ts";
import { isWithin, techniciansWithin } from "../../domain/places.ts";
import { offeredServices, type PricedService } from "../../domain/services.ts";
import { loadSlotSchedule } from "../../domain/slot-times.ts";
import {
  bookableRange,
  codeStands,
  holdForSale,
  linkClosesAt,
  PAYS,
  paysByCredit,
  paysFor,
  saleFor,
  sendHoldLink,
  visitOfHold,
  type Sale,
  type VisitAsked,
} from "../../domain/visit-booking.ts";
import { actorOf } from "../../http/audit.ts";
import { bookHold } from "../../http/book-hold.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorBody, errorResponse, refuse } from "../../http/errors.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { json } from "../../http/openapi.ts";
import { routeReach, withinRouteReach } from "../../http/staff-access.ts";
import { stripStart } from "../../policy/next-visit.ts";
import { windowTimesOf } from "../../policy/slot-times.ts";
import { ServiceSchema } from "../client/booking.ts";
import { PRICE_TIER } from "../../policy/services.ts";

/** A visit's price, as the client's app gives it; the console's own "Price" is a row of the price book. */
const PriceSchema = z
  .object({
    amount_ex_gst: z.number().int().openapi({ description: "In paise, before GST." }),
    amount: z.number().int().openapi({ description: "In paise, GST included: what the client pays." }),
    gst_percent: z.number(),
  })
  .strict()
  .openapi("VisitPrice");

const TechnicianSchema = z.object({ id: z.string(), name: z.string() }).strict().openapi("FreeTechnician");

const ServiceOfferSchema = z
  .object({ tier: z.string(), name: z.string(), minutes: z.number().int(), price: PriceSchema })
  .strict()
  .openapi("ServiceOffer");

const PaysSchema = z.enum(PAYS).openapi({
  description:
    "How the visit is paid for: nothing at booking (free, or a consultation and fit in one visit, paid by a link " +
    "once fitted), a service-visit credit, or a payment link Razorpay texts the client.",
});

const OpsAvailabilitySchema = z
  .object({
    kind: z.enum(VISIT_TYPES),
    services: z.array(ServiceOfferSchema).openapi({ description: "The kind's services offered on the first day." }),
    service: ServiceSchema.openapi({ description: "The service the windows are for: the one asked, else the first." }),
    pays: PaysSchema,
    credits: z.number().int().openapi({ description: "The service-visit credits the client has to spend." }),
    days: z.array(
      z
        .object({
          date: z.iso.date(),
          windows: z.array(
            z
              .object({
                window: z.enum(BOOKING_WINDOWS),
                start: z.string().openapi({ description: "When the window starts that day, in India's time." }),
                end: z.string(),
                technicians: z.array(TechnicianSchema).openapi({
                  description:
                    "Who in the caller's cities is free for the visit, the client's regular technician first.",
                }),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict()
  .openapi("OpsAvailability");

const OUTCOMES = ["booked", "being_booked", "awaiting_payment"] as const;

const OpsBookingSchema = z
  .object({
    hold_id: z.uuid(),
    outcome: z.enum(OUTCOMES).openapi({
      description:
        "booked: the visit is written. being_booked: it is on its way to the field record, within a minute. " +
        "awaiting_payment: the slot is held and the link sent; the visit is booked once the client pays.",
    }),
    visit_id: z.union([z.uuid(), z.null()]).openapi({ description: "The visit, once booked." }),
    pays: PaysSchema,
    service: ServiceSchema,
    price: PriceSchema.openapi({ description: "What the client pays: the service's price less any code." }),
    date: z.iso.date(),
    window: z.enum(BOOKING_WINDOWS),
    technician: TechnicianSchema,
    link: z
      .union([z.object({ url: z.string(), open_until: z.iso.datetime() }).strict(), z.null()])
      .openapi({ description: "The payment link Razorpay texted the client, and when it closes and the slot goes." }),
  })
  .strict()
  .openapi("OpsBooking");

const availabilityRoute = createRoute({
  method: "get",
  path: "/api/visits/availability",
  summary: "A client's windows for a kind of visit over 14 days, and who is free in each",
  request: {
    query: z.object({
      client: z.uuid(),
      kind: z.enum(VISIT_TYPES),
      tier: z
        .string()
        .regex(PRICE_TIER)
        .optional()
        .openapi({ description: "The service; left out, the first offered." }),
      from: z.iso.date().optional().openapi({ description: "The first day; tomorrow if left out, or if earlier." }),
    }),
  },
  responses: {
    200: { description: "Each day's windows", ...json(OpsAvailabilitySchema) },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such client in the caller's cities, or one who has been erased"),
    422: errorResponse(
      "not_bookable: the kind offers no such service; no_product: a first fit, with no hair system on sale",
    ),
  },
});

const VisitToBookSchema = z
  .object({
    client: z.uuid(),
    kind: z.enum(VISIT_TYPES),
    tier: z.string().regex(PRICE_TIER).optional().openapi({
      description: "The service; left out, the kind's standard one. A first fit names the hair system.",
    }),
    technician: z.string().min(1).max(100).optional().openapi({
      description: "The technician ops chose; left out, whoever is free, the client's regular one first.",
    }),
    date: z.iso.date(),
    window: z.enum(BOOKING_WINDOWS),
    one_visit: z
      .boolean()
      .optional()
      .openapi({ description: "A consultation and fit in one visit: a first fit, morning or afternoon." }),
    code: z.string().min(1).max(40).optional().openapi({ description: "A discount code the client gave." }),
  })
  .strict()
  .openapi("VisitToBook");

const bookRoute = createRoute({
  method: "post",
  path: "/api/visits",
  summary: "Book a visit for a client: at once when nothing is paid at booking, else by a payment link",
  request: { body: { required: true, ...json(VisitToBookSchema) } },
  responses: {
    201: { description: "Booked, on its way, or waiting for the link to be paid", ...json(OpsBookingSchema) },
    400: errorResponse("invalid_request: a one visit that is not a first fit, or in the evening"),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such client in the caller's cities, or one who has been erased"),
    409: errorResponse(
      "taken: nobody chosen is free in that window now, or the technician chosen is not in the caller's cities; already_booked: a consultation or first fit is still to " +
        "come, or a payment link for one is open; " +
        "terms_changed: the client's last credit went on another booking a moment before",
    ),
    422: errorResponse(
      "not_bookable: the day, the kind or the service cannot be booked; no_product: a first fit, with no hair " +
        "system on sale that day; code_not_applicable: the code does not apply to this booking",
    ),
    503: errorResponse("unavailable: Razorpay could not make the payment link, so nothing is held"),
  },
});

/** The service the windows are for: the one asked, else the kind's standard one, else the first offered. */
function serviceAsked(services: readonly PricedService[], tier: string | undefined): PricedService | undefined {
  if (tier !== undefined) return services.find((service) => service.tier === tier);
  return services.find((service) => service.tier === "standard") ?? services[0];
}

const serviceBody = (service: { readonly tier: string; readonly name: string; readonly minutes: number }) => ({
  tier: service.tier,
  name: service.name,
  minutes: service.minutes,
});

/** Lets a hold ops made go, with why in their audit entry, since the booking could not go ahead. */
async function letGo(c: Context<AppEnv>, holdId: string, reason: string): Promise<void> {
  const now = c.var.deps.now();
  const entry = {
    surface: "ops",
    actor: actorOf(c),
    action: "booking.give_back",
    subject: { kind: "hold", id: holdId },
    requestId: c.var.requestId,
    detail: { reason },
  } as const;
  await giveBack(c.env.DB, c.var.deps.payments, holdId, now, reason, [auditStatement(c.env.DB, entry, now)]);
}

interface Answer {
  readonly hold: Hold;
  readonly sale: Sale;
  readonly outcome: (typeof OUTCOMES)[number];
  readonly visitId: string | null;
  readonly link: { readonly url: string; readonly open_until: string } | null;
}

const bookingBody = ({ hold, sale, outcome, visitId, link }: Answer) => ({
  hold_id: hold.id,
  outcome,
  visit_id: visitId,
  pays: sale.pays,
  service: serviceBody(sale.service),
  price: sale.price,
  date: hold.date,
  window: hold.window,
  technician: { id: hold.technician.id, name: hold.technician.name },
  link,
});

/**
 * Each day's windows from `start`, and who of `reached` is free in each, where null is every technician; nobody on a
 * day the client may not book.
 */
async function windowsOffered(
  db: D1Database,
  clientId: string,
  service: PricedService,
  days: { readonly start: string; readonly range: { readonly opens: string; readonly last: string } },
  reached: ReadonlySet<string> | null,
  now: Date,
) {
  const visit = { minutes: service.minutes, until: service.retired_date };
  const [free, schedule] = await Promise.all([
    freeTechnicians(db, clientId, visit, days.start, BOOKING_DAYS, now),
    loadSlotSchedule(db),
  ]);
  const shut = (date: string) => date < days.range.opens || date > days.range.last;
  return free.map(({ date, windows }) => {
    const hours = windowTimesOf(schedule.on(date));
    const offered = windows.map((each) => ({
      window: each.window,
      ...hours[each.window],
      technicians: shut(date)
        ? []
        : each.technicians.filter((one) => isWithin(reached, one.id)).map((one) => ({ id: one.id, name: one.name })),
    }));
    return { date, windows: offered };
  });
}

const askedOf = (body: z.infer<typeof VisitToBookSchema>): VisitAsked => ({
  personId: body.client,
  kind: body.kind,
  tier: body.tier,
  technicianId: body.technician,
  date: body.date,
  window: body.window,
  oneVisit: body.one_visit === true,
  code: body.code,
});

/** Whether the client is on our records, not erased, and in the caller's cities. */
async function isClientInReach(c: Context<AppEnv>, client: string): Promise<boolean> {
  const person = await c.env.DB.prepare("SELECT 1 FROM people WHERE id = ?1 AND erased_at IS NULL")
    .bind(client)
    .first();
  return person !== null && withinRouteReach(c, "client", client);
}

/** A booking outside the caller's cities: a client elsewhere is not found, and a technician elsewhere is not free. */
async function refusedElsewhere(c: Context<AppEnv>, asked: VisitAsked) {
  if (!(await withinRouteReach(c, "client", asked.personId))) return { code: "not_found", status: 404 } as const;
  if (asked.technicianId === undefined) return null;
  if (!(await withinRouteReach(c, "technician", asked.technicianId))) return { code: "taken", status: 409 } as const;
  return null;
}

export function registerOpsVisits(app: App): void {
  app.openapi(availabilityRoute, async (c) => {
    const { client, kind, tier, from } = c.req.valid("query");
    const db = c.env.DB;
    const now = c.var.deps.now();
    if (!(await isClientInReach(c, client))) return refuse(c, "not_found");

    const range = bookableRange(now, await opsInputs(c));
    const start = stripStart(from, range, BOOKING_DAYS);
    const services = await offeredServices(db, start, [kind]);
    const service = serviceAsked(services, tier);
    if (service === undefined) {
      const refusal = kind === "first_fit" && services.length === 0 ? "no_product" : "not_bookable";
      return c.json(errorBody(refusal, c.var.requestId), 422);
    }
    const reached = await techniciansWithin(db, await routeReach(c));
    const [strip, credits, onCredit] = await Promise.all([
      windowsOffered(db, client, service, { start, range }, reached, now),
      spendableCredits(db, client, now),
      paysByCredit(db, client, kind, now),
    ]);
    return c.json(
      {
        kind,
        services: services.map((each) => ({ ...serviceBody(each), price: each.price })),
        service: serviceBody(service),
        pays: paysFor(false, onCredit, service.price),
        credits: credits.visits,
        days: strip,
      },
      200,
    );
  });

  app.openapi(bookRoute, async (c) => {
    const asked = askedOf(c.req.valid("json"));
    const db = c.env.DB;
    const now = c.var.deps.now();
    const elsewhere = await refusedElsewhere(c, asked);
    if (elsewhere !== null) return c.json(errorBody(elsewhere.code, c.var.requestId), elsewhere.status);
    const inputs = await opsInputs(c);
    const checked = await saleFor(db, asked, inputs, now);
    if (!checked.ok) {
      const { refusal } = checked;
      if (refusal.status === 400) return c.json(errorBody(refusal.code, c.var.requestId, [...refusal.fields]), 400);
      return c.json(errorBody(refusal.code, c.var.requestId), refusal.status);
    }
    const { sale } = checked;
    const closesAt = sale.pays === "link" ? await linkClosesAt(db, asked, now) : null;
    if (sale.pays === "link" && closesAt === null) return refuse(c, "not_bookable");

    const by = { actor: actorOf(c), requestId: c.var.requestId };
    const graceSeconds = inputs.paymentHold.grace * 60;
    const hold = await holdForSale(db, asked, sale, { closesAt, graceSeconds, by }, now);
    if (hold === null) return refuse(c, "taken");
    if (!(await codeStands(db, asked, hold.id))) {
      await letGo(c, hold.id, "code_taken");
      return refuse(c, "code_not_applicable");
    }
    c.var.log.info("visit_booked_by_ops", { hold_id: hold.id, kind: asked.kind, pays: sale.pays });

    if (closesAt !== null) {
      const deps = { ...c.var.deps, log: c.var.log, messagingSettings: c.var.config.settings.messaging };
      const made = await sendHoldLink(db, deps, { hold, asked, sale, closesAt }, now);
      if (made === null) {
        await letGo(c, hold.id, "link_not_made");
        return refuse(c, "unavailable");
      }
      const link = { url: made.shortUrl, open_until: closesAt.toISOString() };
      return c.json(bookingBody({ hold, sale, outcome: "awaiting_payment", visitId: null, link }), 201);
    }

    if (!(await confirmUnpaid(db, hold.id, now))) {
      await letGo(c, hold.id, "credit_spent");
      return refuse(c, "terms_changed");
    }
    await bookHold(c, hold.id);
    const visitId = await visitOfHold(db, hold.id);
    const outcome = visitId === null ? "being_booked" : "booked";
    return c.json(bookingBody({ hold, sale, outcome, visitId, link: null }), 201);
  });
}
