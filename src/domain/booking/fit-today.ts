// Fit today (docs/decisions/0299-fit-today.md): at a plain consultation the technician has just closed as done, where
// their kit holds a piece made exactly to the client's hair profile and their day has room for the fit from now, the
// fit is booked on the spot as a consultation and fit in one visit (ADR 0105): with them, fixed, paid once the client is
// fitted, by the link the close asks for. Nothing here is a new rule of booking: the hold is the booking engine's, at
// the door's start, and refused where its checks refuse it.

import { HOLD_SECONDS } from "../../config/scheduling.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { ONE_VISIT_TERMS, ONE_VISIT_WINDOWS } from "../../policy/one-visit.ts";
import { readOpsInputs } from "../platform/ops-settings.ts";
import { windowAt } from "../../policy/slot-times.ts";
import { cityOfPerson } from "../cities/cities.ts";
import { currentAddress } from "../clients/profile.ts";
import { hairSystemSpecs } from "../inventory/hair-systems.ts";
import { stockMatch } from "../inventory/stock-match.ts";
import { agreedToToday } from "../privacy/terms-acceptances.ts";
import { landedOutcome } from "../visits/visit-begun.ts";
import { liveVisitOf } from "./availability.ts";
import { confirmUnpaid } from "./bookings.ts";
import { holdSlot } from "./hold-slot.ts";
import { fittingOf } from "./occupancy.ts";
import { bookableService, type PricedService } from "./services.ts";
import { loadSlotSchedule } from "./slot-times.ts";
import { startOffers } from "./start-offers.ts";

/** Why Fit today is not offered. */
export type FitTodayRefusal =
  /** Not this technician's plain consultation, closed as done today. */
  | "not_offered"
  /** The client has a first fit, or a consultation and fit, to come. */
  | "fit_booked"
  /** The client has not agreed to today's terms in their own app or on the site, as a fit sold to them needs. */
  | "terms_needed"
  /** No piece in the technician's kit made exactly to the client's profile. */
  | "not_in_kit"
  /** No first fit of the profile's product on sale today. */
  | "no_product"
  /** No room on the technician's day to begin now, or too late in it for a one visit. */
  | "no_room";

/** The fit offered: the product, the piece in the kit that matches, and when it would start. */
interface FitToday {
  readonly personId: string;
  readonly service: PricedService;
  readonly stock: { readonly code: string; readonly name: string };
  readonly startsAt: Date;
}

type Offered =
  { readonly ok: true; readonly fit: FitToday } | { readonly ok: false; readonly refusal: FitTodayRefusal };

interface Asked {
  readonly technicianId: string;
  readonly jobId: string;
  readonly now: Date;
}

/** The client of the technician's plain consultation closed as done today; null for any other job. */
async function consultedToday(db: D1Database, { technicianId, jobId, now }: Asked): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT a.person_id, a.window_start, ${landedOutcome("a")} AS landed_outcome FROM appointments a
       WHERE a.id = ?1 AND a.technician_id = ?2 AND a.deleted_at IS NULL AND a.type = 'consultation'
         AND a.one_visit IS NULL AND a.person_id IS NOT NULL`,
    )
    .bind(jobId, technicianId)
    .first<{ person_id: string; window_start: string; landed_outcome: string | null }>();
  if (row?.landed_outcome !== "done") return null;
  return indiaDate(new Date(row.window_start)) === indiaDate(now) ? row.person_id : null;
}

/**
 * The piece in the technician's kit made exactly to the client's profile, free or kept for them, with the product it
 * is sold as, the profile's own; null where the kit holds none.
 */
async function inTheKit(db: D1Database, personId: string, technicianId: string) {
  const match = await stockMatch(db, personId);
  if (match.kind !== "stocked") return null;
  const theirs = match.held.find((place) => place.placeId === technicianId);
  const product = (await hairSystemSpecs(db)).get(match.code)?.product;
  if (theirs === undefined || theirs.pieces === 0 || product === undefined) return null;
  return { code: match.code, name: match.name, product };
}

/**
 * The technician's first start from now, where a one visit may start then and it is near enough to begin at once: no
 * later than they may check in ahead of a start (the phone clock's before_start, an hour until ops change it).
 */
async function startFromNow(db: D1Database, personId: string, service: PricedService, asked: Asked) {
  const today = indiaDate(asked.now);
  const [days, schedule, inputs] = await Promise.all([
    startOffers({
      db,
      placing: { personId },
      visit: {
        type: "first_fit",
        minutes: service.minutes,
        fitting: fittingOf("first_fit", service.tier),
        atTheDoor: true,
      },
      from: today,
      days: 1,
      now: asked.now,
    }),
    loadSlotSchedule(db),
    readOpsInputs(db, asked.now),
  ]);
  const first = (days[0]?.starts ?? []).find((start) =>
    start.takers.some((taker) => taker.technician.id === asked.technicianId),
  );
  if (first === undefined) return null;
  if (first.startsAt.getTime() - asked.now.getTime() > inputs.phoneClock.before_start * 60_000) return null;
  const window = windowAt(first.time, schedule.on(today));
  return (ONE_VISIT_WINDOWS as readonly string[]).includes(window) ? { startsAt: first.startsAt, window } : null;
}

/** Fit today, offered where the consultation, the client, the kit and the day allow it; else why not. */
export async function fitTodayOf(db: D1Database, asked: Asked): Promise<Offered> {
  const personId = await consultedToday(db, asked);
  if (personId === null) return { ok: false, refusal: "not_offered" };
  if ((await liveVisitOf(db, personId, { type: "first_fit", now: asked.now })) !== null) {
    return { ok: false, refusal: "fit_booked" };
  }
  if (!(await agreedToToday(db, personId))) return { ok: false, refusal: "terms_needed" };
  const stock = await inTheKit(db, personId, asked.technicianId);
  if (stock === null) return { ok: false, refusal: "not_in_kit" };
  const city = await cityOfPerson(db, personId);
  const service = await bookableService(db, { kind: "first_fit", tier: stock.product, on: indiaDate(asked.now), city });
  if (service === null) return { ok: false, refusal: "no_product" };
  const start = await startFromNow(db, personId, service, asked);
  if (start === null) return { ok: false, refusal: "no_room" };
  return {
    ok: true,
    fit: { personId, service, stock: { code: stock.code, name: stock.name }, startsAt: start.startsAt },
  };
}

/**
 * Fit today held and confirmed, as ops book a consultation and fit in one visit with the technician they chose: nothing
 * paid now, sold under the one visit's terms. The hold's ID, for the caller to book; else why not.
 */
export async function holdFitToday(
  db: D1Database,
  asked: Asked,
): Promise<{ readonly ok: true; readonly holdId: string } | { readonly ok: false; readonly refusal: FitTodayRefusal }> {
  const offered = await fitTodayOf(db, asked);
  if (!offered.ok) return offered;
  const { personId, service, startsAt } = offered.fit;
  const address = await currentAddress(db, personId);
  const today = indiaDate(asked.now);
  const schedule = await loadSlotSchedule(db);
  const hold = await holdSlot({
    db,
    input: {
      personId,
      service: { type: "first_fit", tier: service.tier, minutes: service.minutes },
      date: today,
      window: schedule.at(startsAt.toISOString()).window,
      startsAt,
      price: { amount: 0, amount_ex_gst: 0, gst_percent: service.price.gst_percent },
      terms: ONE_VISIT_TERMS,
      pincode: address?.pincode ?? null,
      oneVisit: true,
      from: "ops",
      technicianId: asked.technicianId,
      atTheDoor: true,
    },
    now: asked.now,
    holdSeconds: HOLD_SECONDS,
    drives: null,
  });
  if (hold === null || !(await confirmUnpaid(db, hold.id, asked.now))) return { ok: false, refusal: "no_room" };
  return { ok: true, holdId: hold.id };
}
