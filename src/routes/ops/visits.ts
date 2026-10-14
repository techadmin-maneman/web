// Booking a visit for a client from the console (src/domain/booking/visit-booking.ts), on the ops surface behind Access.
//
// Both keep to the caller's cities: a client elsewhere is not found, and only the technicians there are offered. The
// booking is audited in the batch that holds its slot (ADR 0031).

import { recommendedProduct } from "../../domain/clients/hair-profiles.ts";
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { BOOKING_DAYS, BOOKING_WINDOWS } from "../../config/scheduling.ts";
import { VISIT_TYPES, type VisitType } from "../../config/visit-types.ts";
import { freeTechnicians } from "../../domain/booking/availability.ts";
import { confirmUnpaid } from "../../domain/booking/bookings.ts";
import { giveBack } from "../../domain/booking/give-back.ts";
import type { Hold } from "../../domain/booking/hold-slot.ts";
import { remakesOwed, type Remake } from "../../domain/booking/remakes.ts";
import { offeredServices, type PricedService } from "../../domain/booking/services.ts";
import { loadSlotSchedule } from "../../domain/booking/slot-times.ts";
import {
  bookableRange,
  codeStillApplies,
  holdForSale,
  linkClosesAt,
  paysByCredit,
  paysFor,
  saleFor,
  sendHoldLink,
  visitOfHold,
  type Sale,
  type VisitAsked,
} from "../../domain/booking/visit-booking.ts";
import { isWithin, techniciansWithin } from "../../domain/clients/places.ts";
import { spendableCredits } from "../../domain/money/credits.ts";
import { auditStatement } from "../../domain/platform/audit.ts";
import { actorOf } from "../../http/audit.ts";
import { bookHold } from "../../http/book-hold.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorBody, errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { routeReach, withinRouteReach } from "../../http/staff-access.ts";
import { stripStart } from "../../policy/next-visit.ts";
import { PRICE_TIER } from "../../policy/services.ts";
import { windowTimesOf } from "../../policy/slot-times.ts";
import { ServiceSchema } from "../schemas/booking.ts";
import { fittingOf } from "../../domain/booking/occupancy.ts";
import { cityOfPerson } from "../../domain/cities/cities.ts";
import { OpsAvailabilitySchema, PaysSchema, PriceSchema, TechnicianSchema } from "./visits.schemas.ts";

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

const AvailabilityQuerySchema = z.object({
  client: z.uuid(),
  kind: z.enum(VISIT_TYPES),
  tier: z.string().regex(PRICE_TIER).optional().openapi({
    description:
      "The service; left out, the one the client's profile recommends for a first fit, else the standard one.",
  }),
  from: z.iso.date().optional().openapi({ description: "The first day; tomorrow if left out, or if earlier." }),
});
type AvailabilityQuery = z.infer<typeof AvailabilityQuerySchema>;

const availabilityRoute = createRoute({
  method: "get",
  path: "/api/visits/availability",
  summary: "A client's windows for a kind of visit over 14 days, and who is free in each",
  request: { query: AvailabilityQuerySchema },
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
    technician: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .openapi({
        description:
          "The technician ops chose; left out, whoever is free. Never the one who took the client's visit just before or " +
          "just after it.",
      }),
    date: z.iso.date(),
    window: z.enum(BOOKING_WINDOWS),
    one_visit: z
      .boolean()
      .optional()
      .openapi({ description: "A consultation and fit in one visit: a first fit, morning or afternoon." }),
    code: z.string().min(1).max(40).optional().openapi({ description: "A discount code the client gave." }),
    covers: z.string().min(1).max(64).optional().openapi({
      description:
        "One of availability's `owed`, which the visit makes good: free, with no late fee. Not with a one visit or a code.",
    }),
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
    400: errorResponse(
      "invalid_request: a one visit that is not a first fit, or in the evening; covers for nothing owed of the kind, or with a one visit or a code",
    ),
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

/**
 * The service the windows are for: the one asked; else the one the client's profile recommends, which only a first fit
 * has; else the kind's standard one; else the first offered.
 */
function serviceAsked(
  services: readonly PricedService[],
  { tier, recommended }: { tier: string | undefined; recommended: string | null },
): PricedService | undefined {
  if (tier !== undefined) return services.find((service) => service.tier === tier);
  const named = (wanted: string | null) => services.find((service) => service.tier === wanted);
  return named(recommended) ?? named("standard") ?? services[0];
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
  await giveBack({ db: c.env.DB, payments: c.var.deps.payments, now }, holdId, reason, {
    alongside: [auditStatement(c.env.DB, entry, now)],
  });
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
async function windowsOffered({
  db,
  clientId,
  service,
  days,
  reached,
  now,
}: {
  db: D1Database;
  clientId: string;
  service: PricedService;
  days: { readonly start: string; readonly range: { readonly opens: string; readonly last: string } };
  reached: ReadonlySet<string> | null;
  now: Date;
}) {
  const visit = {
    minutes: service.minutes,
    until: service.retired_date,
    fitting: fittingOf(service.kind, service.tier),
  };
  const [free, schedule] = await Promise.all([
    freeTechnicians({ db, personId: clientId, visit, from: days.start, days: BOOKING_DAYS, now }),
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
  covers: body.covers,
});

/** What a visit of the kind may make good, as availability answers it. */
const owedOf = (owed: readonly Remake[], kind: VisitType) =>
  owed
    .filter((each) => each.kind === kind)
    .map((each) => ({ id: each.id, why: each.why, piece_code: each.pieceCode, since: each.since }));

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

/** A client's fortnight of windows for a kind of visit, who is free in each and how it would be paid. */
async function availability(c: Context<AppEnv>, query: AvailabilityQuery) {
  const { client, kind, tier, from } = query;
  const db = c.env.DB;
  const now = c.var.deps.now();
  if (!(await isClientInReach(c, client))) return refuse(c, "not_found");

  const range = bookableRange(now, await opsInputs(c));
  const start = stripStart(from, range, BOOKING_DAYS);
  const [services, recommended] = await Promise.all([
    offeredServices(db, start, [kind], await cityOfPerson(db, client)),
    kind === "first_fit" ? recommendedProduct(db, client) : Promise.resolve(null),
  ]);
  const service = serviceAsked(services, { tier, recommended });
  if (service === undefined) {
    const refusal = kind === "first_fit" && services.length === 0 ? "no_product" : "not_bookable";
    return c.json(errorBody(refusal, c.var.requestId), 422);
  }
  const reached = await techniciansWithin(db, await routeReach(c));
  const [strip, credits, onCredit, owed] = await Promise.all([
    windowsOffered({ db, clientId: client, service, days: { start, range }, reached, now }),
    spendableCredits(db, client, now),
    paysByCredit(db, client, kind, now),
    remakesOwed(db, client),
  ]);
  return c.json(
    {
      kind,
      services: services.map((each) => ({ ...serviceBody(each), price: each.price })),
      service: serviceBody(service),
      recommended,
      pays: paysFor(false, onCredit, service.price),
      credits: credits.visits,
      owed: owedOf(owed, kind),
      days: strip,
    },
    200,
  );
}

export function registerOpsVisits(app: App): void {
  app.openapi(availabilityRoute, (c) => availability(c, c.req.valid("query")));

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
    const closesAt = sale.pays === "link" ? await linkClosesAt(db, asked, now, inputs.paymentLinks) : null;
    if (sale.pays === "link" && closesAt === null) return refuse(c, "not_bookable");

    const by = { actor: actorOf(c), requestId: c.var.requestId };
    const graceSeconds = inputs.paymentHold.grace * 60;
    const hold = await holdForSale({ db, asked, sale, hold: { closesAt, graceSeconds, by }, now });
    if (hold === null) return refuse(c, "taken");
    if (!(await codeStillApplies(db, asked, hold.id))) {
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
