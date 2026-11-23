// Fit today (docs/decisions/0299-fit-today.md): at a plain consultation the technician has just closed as done, the
// client going ahead, where their kit holds a piece made exactly to the client's hair profile and their day has room for
// the fit from now, the fit is booked on the spot as a consultation and fit in one visit (ADR 0105): with them, fixed,
// paid once the client is fitted. Nothing here is a new rule of booking: the hold is the booking engine's, at the door's
// start, its drives checked on Google, and refused where its checks refuse it.

import { HOLD_SECONDS } from "../../config/scheduling.ts";
import { addDays, indiaDate, indiaInstant } from "../../lib/india-time.ts";
import { ONE_VISIT_TERMS, ONE_VISIT_WINDOWS } from "../../policy/one-visit.ts";
import { windowAt } from "../../policy/slot-times.ts";
import { cityOfPerson } from "../cities/cities.ts";
import { currentAddress } from "../clients/profile.ts";
import { hairSystemSpecs } from "../inventory/hair-systems.ts";
import { stockMatch } from "../inventory/stock-match.ts";
import { readOpsInputs, type OpsInputs } from "../platform/ops-settings.ts";
import { agreedToToday } from "../privacy/terms-acceptances.ts";
import { liveVisitOf } from "./availability.ts";
import { confirmUnpaid } from "./bookings.ts";
import type { DriveCheck } from "./drive-check.ts";
import { holdSlot } from "./hold-slot.ts";
import { fittingOf } from "./occupancy.ts";
import { bookableService, type PricedService } from "./services.ts";
import { loadSlotSchedule } from "./slot-times.ts";
import { startOffers } from "./start-offers.ts";
import { linkStillOpen } from "./visit-booking.ts";

/** Why Fit today is not offered. */
export type FitTodayRefusal =
  /** Not this technician's plain consultation, closed as done today within the hour, the client going ahead. */
  | "not_offered"
  /** The client has a first fit, a consultation and fit, a consultation or a first fit's payment link to come. */
  | "fit_booked"
  /** The client has not agreed to today's terms in their own app or on the site, as a fit sold to them needs. */
  | "terms_needed"
  /** No piece in the technician's kit made exactly to the client's profile, or of the product they picked. */
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

/** How the consultation's close landed: its result, whether the client is going ahead, and what they picked. */
interface Close {
  readonly outcome?: unknown;
  readonly going_ahead?: unknown;
  readonly lost_reason?: unknown;
  /** The product the client picked on Options, by its tier, where they picked one (ADR 0247). */
  readonly product?: unknown;
}

/** The consultation's client, and the product they picked on Options, where they did. */
interface Consulted {
  readonly personId: string;
  readonly picked: string | null;
}

/**
 * The client of the technician's plain consultation today, closed as done with the client going ahead, its close made
 * on the phone and reaching us no longer ago than the technician may check in ahead of a start (the phone clock's
 * before_start), so they are still at the door: a close sent late, once signal came back, is not; null for any other
 * job.
 */
async function consultedToday(db: D1Database, asked: Asked, inputs: OpsInputs): Promise<Consulted | null> {
  const { technicianId, jobId, now } = asked;
  const row = await db
    .prepare(
      `SELECT a.person_id, a.window_start, e.body, e.occurred_at, e.received_at FROM appointments a
       JOIN job_events e ON e.id = (SELECT je.id FROM job_events je
         WHERE je.appointment_id = a.id AND je.kind = 'outcome' AND je.superseded = 0
         ORDER BY je.received_at DESC, je.rowid DESC LIMIT 1)
       WHERE a.id = ?1 AND a.technician_id = ?2 AND a.deleted_at IS NULL AND a.type = 'consultation'
         AND a.one_visit IS NULL AND a.person_id IS NOT NULL`,
    )
    .bind(jobId, technicianId)
    .first<{ person_id: string; window_start: string; body: string; occurred_at: string; received_at: string }>();
  if (row === null || indiaDate(new Date(row.window_start)) !== indiaDate(now)) return null;
  const close = JSON.parse(row.body) as Close;
  if (close.outcome !== "done" || close.going_ahead !== true || close.lost_reason !== undefined) return null;
  const since = now.getTime() - Math.min(Date.parse(row.occurred_at), Date.parse(row.received_at));
  if (since > inputs.phoneClock.before_start * 60_000) return null;
  return { personId: row.person_id, picked: typeof close.product === "string" ? close.product : null };
}

/** Whether the client has a fit, or a consultation, to come, or a first fit's link still open, which a fit would double. */
async function fitToCome(db: D1Database, personId: string, now: Date): Promise<boolean> {
  const [fit, consultation, link] = await Promise.all([
    liveVisitOf(db, personId, { type: "first_fit", now }),
    liveVisitOf(db, personId, { type: "consultation", now }),
    linkStillOpen(db, personId, "first_fit", now),
  ]);
  return fit !== null || consultation !== null || link;
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
async function startFromNow(
  db: D1Database,
  personId: string,
  service: PricedService,
  at: Asked & { inputs: OpsInputs },
) {
  const today = indiaDate(at.now);
  const [days, schedule] = await Promise.all([
    startOffers({
      db,
      placing: { personId },
      visit: {
        type: "first_fit",
        minutes: service.minutes,
        fitting: fittingOf("first_fit", service.tier),
        atTheDoor: at.technicianId,
      },
      from: today,
      days: 1,
      now: at.now,
      inputs: at.inputs,
    }),
    loadSlotSchedule(db),
  ]);
  const first = (days[0]?.starts ?? []).find((start) =>
    start.takers.some((taker) => taker.technician.id === at.technicianId),
  );
  if (first === undefined) return null;
  if (first.startsAt.getTime() - at.now.getTime() > at.inputs.phoneClock.before_start * 60_000) return null;
  const window = windowAt(first.time, schedule.on(today));
  return (ONE_VISIT_WINDOWS as readonly string[]).includes(window) ? first.startsAt : null;
}

/** Fit today, offered where the consultation, the client, the kit and the day allow it; else why not. */
export async function fitTodayOf(db: D1Database, asked: Asked): Promise<Offered> {
  const inputs = await readOpsInputs(db, asked.now);
  const consulted = await consultedToday(db, asked, inputs);
  if (consulted === null) return { ok: false, refusal: "not_offered" };
  const { personId } = consulted;
  if (await fitToCome(db, personId, asked.now)) return { ok: false, refusal: "fit_booked" };
  if (!(await agreedToToday(db, personId))) return { ok: false, refusal: "terms_needed" };
  const stock = await inTheKit(db, personId, asked.technicianId);
  // The piece is the profile's product's; a client who picked another on Options is fitted with theirs, by ops.
  if (stock === null || (consulted.picked !== null && consulted.picked !== stock.product)) {
    return { ok: false, refusal: "not_in_kit" };
  }
  const city = await cityOfPerson(db, personId);
  const service = await bookableService(db, { kind: "first_fit", tier: stock.product, on: indiaDate(asked.now), city });
  if (service === null) return { ok: false, refusal: "no_product" };
  const startsAt = await startFromNow(db, personId, service, { ...asked, inputs });
  if (startsAt === null) return { ok: false, refusal: "no_room" };
  return { ok: true, fit: { personId, service, stock: { code: stock.code, name: stock.name }, startsAt } };
}

/**
 * Fit today held and confirmed, as ops book a consultation and fit in one visit with the technician they chose: nothing
 * paid now, sold under the one visit's terms, the drives either side asked of Google first where it is on. The hold's
 * ID, for the caller to book; else why not.
 */
export async function holdFitToday(
  db: D1Database,
  asked: Asked,
  drives: DriveCheck | null,
): Promise<{ readonly ok: true; readonly holdId: string } | { readonly ok: false; readonly refusal: FitTodayRefusal }> {
  const offered = await fitTodayOf(db, asked);
  if (!offered.ok) return offered;
  const { personId, service, startsAt } = offered.fit;
  const [address, schedule] = await Promise.all([currentAddress(db, personId), loadSlotSchedule(db)]);
  const hold = await holdSlot({
    db,
    input: {
      personId,
      service: { type: "first_fit", tier: service.tier, minutes: service.minutes },
      date: indiaDate(asked.now),
      window: schedule.at(startsAt.toISOString()).window,
      startsAt,
      price: { amount: 0, amount_ex_gst: 0, gst_percent: service.price.gst_percent },
      terms: ONE_VISIT_TERMS,
      pincode: address?.pincode ?? null,
      oneVisit: true,
      from: "ops",
      technicianId: asked.technicianId,
      atTheDoor: asked.technicianId,
    },
    now: asked.now,
    holdSeconds: HOLD_SECONDS,
    drives,
  });
  if (hold === null || !(await confirmUnpaid(db, hold.id, asked.now))) return { ok: false, refusal: "no_room" };
  return { ok: true, holdId: hold.id };
}

/**
 * The fit this technician booked at the door today for the consultation's client, where they did: a booking asked again,
 * as a tap after the phone stopped waiting for the first, or after the hour, is answered with it. Its visit's ID, or
 * null for a hold confirmed whose visit the half-hour pass has still to book; undefined where there is none.
 */
export async function bookedAtTheDoor(db: D1Database, asked: Asked): Promise<string | null | undefined> {
  const today = indiaDate(asked.now);
  const row = await db
    .prepare(
      `SELECT f.id FROM appointments f
       WHERE f.person_id = (SELECT c.person_id FROM appointments c WHERE c.id = ?1 AND c.technician_id = ?2)
         AND f.technician_id = ?2 AND f.type = 'first_fit' AND f.one_visit IS NOT NULL AND f.deleted_at IS NULL
         AND f.window_start >= ?3 AND f.window_start < ?4
       UNION ALL
       SELECT NULL FROM slot_holds h
       WHERE h.person_id = (SELECT c.person_id FROM appointments c WHERE c.id = ?1 AND c.technician_id = ?2)
         AND h.technician_id = ?2 AND h.type = 'first_fit' AND h.one_visit = 1 AND h.date = ?5 AND h.state = 'held'
         AND h.confirmed_at IS NOT NULL AND h.appointment_id IS NULL
       LIMIT 1`,
    )
    .bind(
      asked.jobId,
      asked.technicianId,
      indiaInstant(today, "00:00").toISOString(),
      indiaInstant(addDays(today, 1), "00:00").toISOString(),
      today,
    )
    .first<{ id: string | null }>();
  return row === null ? undefined : row.id;
}
