// The windows open for a service in the app (./booking.ts): 14 days of the windows the visit can start in, and who
// could come.

import { z } from "@hono/zod-openapi";
import { BOOKING_DAYS, BOOKING_WINDOWS } from "../../config/scheduling.ts";
import { VISIT_TYPES } from "../../config/visit-types.ts";
import { availability } from "../../domain/booking/availability.ts";
import { loadSlotSchedule } from "../../domain/booking/slot-times.ts";
import { currentAddress } from "../../domain/clients/profile.ts";
import { isServed } from "../../domain/clients/service-area.ts";
import { type Price, priceOf } from "../../domain/money/price-book.ts";
import { termsInForce } from "../../domain/visits/visit-changes.ts";
import { bookable, movedService, moveTermsFor, rangeFor } from "../../http/client-booking.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { errorBody, errorResponse, refuse } from "../../http/errors.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { selfServeRoute } from "../../http/session-routes.ts";
import { indiaInstant } from "../../lib/india-time.ts";
import { changeChargedOnBooking } from "../../policy/moving-a-visit.ts";
import { stripStart } from "../../policy/next-visit.ts";
import { windowTimesOf } from "../../policy/slot-times.ts";
import { PriceSchema, ServiceSchema, Tier } from "../schemas/booking.ts";

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
/** Whether the client's address is in a pincode we do not come to; false while they have given none. */
async function addressOutsideArea(db: D1Database, personId: string): Promise<boolean> {
  const address = await currentAddress(db, personId);
  if (address === null) return false;
  return !(await isServed(db, address.pincode));
}

/** A service as the API names it. */
const serviceBody = (service: { readonly tier: string; readonly name: string; readonly minutes: number }) => ({
  tier: service.tier,
  name: service.name,
  minutes: service.minutes,
});

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

export function registerClientAvailability(app: App): void {
  app.openapi(availabilityRoute, async (c) => {
    const session = clientOf(c);
    const { type, tier, from, moving: movingId } = c.req.valid("query");
    const now = c.var.deps.now();
    const range = await rangeFor(c, session.subjectId, type);
    const start = stripStart(from, range, BOOKING_DAYS);
    const move =
      movingId === undefined
        ? null
        : await moveTermsFor({ c, personId: session.subjectId, visitId: movingId, type, on: start });
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
      availability({ db, placing, visit: { minutes: service.minutes, until }, from: start, days: BOOKING_DAYS, now }),
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
}
