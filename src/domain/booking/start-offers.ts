// The starts a visit may be booked at (docs/decisions/0210-booking-by-start-time.md): each day's starts a step apart
// that some technician in the visit's city can take, and who, best first. Best is whoever the visit adds the least
// driving to, then whoever has the least booked that day, then over the week around it.
//
// Today is offered from the lead time on, and only for a kind of visit ops let clients book for today. A day ops
// black out, or from the day a service is retired on, is offered to nobody; and no technician who took the client's
// visit just before or just after that day takes it, unless nobody else can.

import type { VisitType } from "../../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant, indiaTime } from "../../lib/india-time.ts";
import type { Pin } from "../../lib/geo.ts";
import { minuteOf, placements, timeOf, type PlanRules } from "../../policy/day-plan.ts";
import { allowedTechnicians, techniciansBarredOn } from "../../policy/technician-rotation.ts";
import { readOpsInputs, type OpsInputs } from "../platform/ops-settings.ts";
import { tieRange } from "./technician-choice.ts";
import { loadDayPlans, type DayPlans, type Leaving } from "./day-plans.ts";
import { loadBlackouts, techniciansFor, type Fitting, type Moving, type Technician } from "./occupancy.ts";
import { visitsOfClient } from "./technician-rotation.ts";

/** A visit to place: its kind, how long it takes, the day its service is retired from, and the fit it is. */
export interface StartVisit {
  /** Left out, today is not offered. */
  readonly type?: VisitType | null;
  readonly minutes: number;
  readonly until?: string | null;
  readonly fitting?: Fitting | null;
}

/** Whose visit it is and where, and what the days are read without. */
export interface StartPlacing {
  readonly personId: string | null;
  readonly moving?: Moving | null;
  readonly replacing?: string | null;
  readonly pincode?: string | null;
  readonly leaving?: Leaving;
}

/** A technician who can take a start, the driving it adds to their day, and the lock the hold on their day takes. */
export interface Taker {
  readonly technician: Technician;
  readonly addedDrive: number;
  readonly revision: number;
}

export interface StartOffer {
  /** India's clock, "HH:MM". */
  readonly time: string;
  readonly startsAt: Date;
  readonly takers: readonly Taker[];
}

export interface DayStarts {
  readonly date: string;
  readonly starts: readonly StartOffer[];
}

/** Where the visit is: its client's current pin, else the centre of the pincode it is booked at or the client's. */
export async function pinOfVisit(db: D1Database, placing: Pick<StartPlacing, "personId" | "pincode">): Promise<Pin | null> {
  const row = await db
    .prepare(
      `SELECT COALESCE(d.lat, sp.centre_lat) AS lat, COALESCE(d.lng, sp.centre_lng) AS lng
       FROM (SELECT ?1 AS person, ?2 AS pincode) w
       LEFT JOIN addresses d ON d.person_id = w.person AND d.replaced_at IS NULL
       LEFT JOIN serviceable_pincodes sp ON sp.pincode = COALESCE(w.pincode, d.pincode)`,
    )
    .bind(placing.personId, placing.pincode ?? null)
    .first<{ lat: number | null; lng: number | null }>();
  const lat = row?.lat ?? null;
  const lng = row?.lng ?? null;
  return lat === null || lng === null ? null : { lat, lng };
}

/** The rules a plan runs to, from the inputs ops set. */
export const planRulesOf = (inputs: OpsInputs): PlanRules => ({
  booking: inputs.bookingRules,
  drive: inputs.driveEstimate,
});

/** The first start a day may offer, in minutes from midnight; null for a today not offered. */
function earliestOn(date: string, visit: StartVisit, inputs: OpsInputs, now: Date): number | null {
  const today = indiaDate(now);
  if (date < today) return null;
  if (date > today) return 0;
  if (visit.type === undefined || visit.type === null || inputs.sameDayBooking[visit.type] !== "yes") return null;
  return minuteOf(indiaTime(now)) + inputs.bookingRules.lead * 60;
}

/** Booked minutes on a technician's day, and over the week around it, to share work out. */
function loadOf(plans: DayPlans, technicianId: string, date: string): { day: number; week: number } {
  const minutes = (day: string) =>
    (plans.day(technicianId, day)?.stops ?? []).reduce((sum, stop) => sum + stop.end - stop.start, 0);
  const { from } = tieRange(date);
  let week = 0;
  for (let day = from; day <= tieRange(date).to; day = addDays(day, 1)) week += minutes(day);
  return { day: minutes(date), week };
}

/** Each day from `from`, for `days` days, with the starts some technician can take and who, best first. */
export async function startOffers(input: {
  readonly db: D1Database;
  readonly placing: StartPlacing;
  readonly visit: StartVisit;
  readonly from: string;
  readonly days: number;
  readonly now: Date;
  /** The inputs in force, where the caller has read them already. */
  readonly inputs?: OpsInputs;
}): Promise<DayStarts[]> {
  const { db, placing, visit, from, days, now } = input;
  const to = addDays(from, days - 1);
  const place = { pincode: placing.pincode ?? null, personId: placing.personId };
  const [technicians, closed, clientVisits, inputs, pin] = await Promise.all([
    techniciansFor(db, placing.moving ?? null, place, visit.fitting ?? null),
    loadBlackouts(db, from, to, place),
    visitsOfClient(db, placing.personId, placing.moving?.visitId ?? placing.replacing ?? null),
    input.inputs ?? readOpsInputs(db, now),
    pinOfVisit(db, placing),
  ]);
  const plans = await loadDayPlans({
    db,
    technicianIds: technicians.map((technician) => technician.id),
    from: tieRange(from).from,
    to: tieRange(to).to,
    now,
    hours: inputs.workingHours,
    leaving: { ...placing.leaving, visitId: placing.moving?.visitId ?? placing.leaving?.visitId ?? null },
  });
  const rules = planRulesOf(inputs);
  const toPlan = { minutes: visit.minutes, pin, fit: visit.fitting !== null && visit.fitting !== undefined };
  const retired = (date: string) => visit.until !== undefined && visit.until !== null && date >= visit.until;
  return Array.from({ length: days }, (_, index): DayStarts => {
    const date = addDays(from, index);
    const earliest = earliestOn(date, visit, inputs, now);
    if (earliest === null || closed.has(date) || retired(date)) return { date, starts: [] };
    const byStart = new Map<number, (Taker & { load: { day: number; week: number } })[]>();
    for (const technician of technicians) {
      const day = plans.day(technician.id, date);
      if (day === null) continue;
      const load = loadOf(plans, technician.id, date);
      for (const placed of placements(day, toPlan, rules, earliest)) {
        const takers = byStart.get(placed.start) ?? [];
        takers.push({ technician, addedDrive: placed.addedDrive, revision: plans.revision(technician.id, date), load });
        byStart.set(placed.start, takers);
      }
    }
    const barred = techniciansBarredOn(clientVisits, date);
    const starts = [...byStart.entries()]
      .sort(([a], [b]) => a - b)
      .map(([start, takers]): StartOffer => {
        const allowed = allowedTechnicians(takers, (taker) => barred.has(taker.technician.id)).sort(
          (a, b) => a.addedDrive - b.addedDrive || a.load.day - b.load.day || a.load.week - b.load.week,
        );
        const time = timeOf(start);
        return {
          time,
          startsAt: indiaInstant(date, time),
          takers: allowed.map(({ technician, addedDrive, revision }) => ({ technician, addedDrive, revision })),
        };
      });
    return { date, starts };
  });
}
