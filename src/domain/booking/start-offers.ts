// The starts a visit may be booked at (docs/decisions/0210-booking-by-start-time.md): each day's starts a step apart
// that some technician in the visit's city can take, and who, best first. Best is whoever's home is known, then whoever
// the visit costs least (src/policy/allotment.ts), then whoever has the least booked that day, then over the week.
//
// Today is offered from the lead time on, and only for a kind of visit ops let clients book for today. A day ops
// black out, or from the day a service is retired on, is offered to nobody; and no technician who took the client's
// visit just before or just after that day takes it, unless nobody else can.

import type { VisitType } from "../../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant, indiaTime } from "../../lib/india-time.ts";
import type { Pin } from "../../lib/geo.ts";
import { minuteOf, placements, timeOf, type PlanRules } from "../../policy/day-plan.ts";
import { allowedTechnicians, techniciansBarredOn } from "../../policy/technician-rotation.ts";
import { standingOf, type Standing } from "../../policy/reach.ts";
import { costOf, type Piece } from "../../policy/allotment.ts";
import { readOpsInputs, type OpsInputs } from "../platform/ops-settings.ts";
import { tieRange } from "./technician-choice.ts";
import { loadDayPlans, type CityOf, type DayPlans, type Leaving } from "./day-plans.ts";
import { bookingCity, loadBlackouts, techniciansFor, type Fitting, type Moving, type Technician } from "./occupancy.ts";
import { visitsOfClient } from "./technician-rotation.ts";
import { keptDrivesFit } from "./drive-check.ts";
import { keptDriveThrough } from "../platform/road-drives.ts";
import type { Point, RouteResult } from "../../providers/routes/index.ts";

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

/**
 * A technician who can take a start, the driving it adds to their day, what their taking it costs in all
 * (src/policy/allotment.ts), whether their home is known, and the lock the hold on their day takes.
 */
interface Taker {
  readonly technician: Technician;
  readonly addedDrive: number;
  readonly cost: number;
  /** False for one with no home pin, whose driving nobody can tell: they go after everyone whose home is known. */
  readonly homeKnown: boolean;
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

/** The pincode a visit is at: the one it is booked at, else its client's current address's. */
const PINCODE = `COALESCE(?2, (SELECT d.pincode FROM addresses d WHERE d.person_id = ?1 AND d.replaced_at IS NULL))`;

/** Where the visit is: its client's current pin, else the centre of the pincode it is booked at or the client's. */
export async function pinOfVisit(
  db: D1Database,
  placing: Pick<StartPlacing, "personId" | "pincode">,
): Promise<Pin | null> {
  const row = await db
    .prepare(
      `SELECT COALESCE(
           (SELECT d.lat FROM addresses d WHERE d.person_id = ?1 AND d.replaced_at IS NULL AND d.lng IS NOT NULL),
           (SELECT sp.centre_lat FROM serviceable_pincodes sp WHERE sp.pincode = ${PINCODE})) AS lat,
         COALESCE(
           (SELECT d.lng FROM addresses d WHERE d.person_id = ?1 AND d.replaced_at IS NULL AND d.lat IS NOT NULL),
           (SELECT sp.centre_lng FROM serviceable_pincodes sp WHERE sp.pincode = ${PINCODE})) AS lng`,
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

/** Where the visit sits for a technician, and whether their home is known to measure it from. */
interface Placing {
  readonly standing: Standing;
  readonly homeKnown: boolean;
}

interface Radius {
  readonly id: string;
  readonly home_lat: number | null;
  readonly home_lng: number | null;
  readonly radius_km: number | null;
}

/** Each home and radius of the technicians of the visit's city, read beside who may take it rather than after. */
async function radiiIn(db: D1Database, cityOf: CityOf): Promise<ReadonlyMap<string, Radius>> {
  const { results } = await db
    .prepare(`SELECT id, home_lat, home_lng, radius_km FROM technicians WHERE city = ${bookingCity("?1", "?2")}`)
    .bind(cityOf.pincode, cityOf.personId)
    .all<Radius>();
  return new Map(results.map((row) => [row.id, row]));
}

/**
 * Where the visit's pin sits for each technician who may take it, inside their radius or in the overflow ring past it
 * (docs/decisions/0289-who-takes-a-visit.md), those beyond both left out. A move's own technician, `keeping`, may keep
 * it wherever they are; anyone else is measured as for a new booking.
 */
function standings(
  technicians: readonly Technician[],
  rows: ReadonlyMap<string, Radius>,
  at: { readonly pin: Pin | null; readonly keeping: string | null; readonly inputs: OpsInputs },
): Map<string, Placing> {
  const placed = new Map<string, Placing>();
  for (const technician of technicians) {
    if (technician.id === at.keeping) {
      placed.set(technician.id, { standing: "inside", homeKnown: true });
      continue;
    }
    const row = rows.get(technician.id);
    const lat = row?.home_lat ?? null;
    const lng = row?.home_lng ?? null;
    const home = lat === null || lng === null ? null : { lat, lng };
    const standing = standingOf({
      home,
      to: at.pin,
      radiusKm: row?.radius_km ?? at.inputs.technicianRadiusKm,
      overflow: at.inputs.allotment.overflow,
    });
    if (standing !== "beyond") placed.set(technician.id, { standing, homeKnown: home !== null });
  }
  return placed;
}

/** A technician who can take a start, before what their taking it costs is counted against the others'. */
interface Candidate {
  readonly technician: Technician;
  readonly addedDrive: number;
  readonly revision: number;
  readonly load: { readonly day: number; readonly week: number };
  readonly overflow: boolean;
  readonly piece: Piece | null;
  readonly homeKnown: boolean;
}

/**
 * Those who can take a start, best first: whoever's home is known, then least cost, then less booked. `leastWeek` is
 * the least booked week of everyone who works the day, so a cost means the same at every start of it.
 */
function bestFirst(candidates: readonly Candidate[], inputs: OpsInputs, leastWeek: number): Taker[] {
  return candidates
    .map((candidate) => ({
      candidate,
      cost: costOf({ ...candidate, weekMinutes: candidate.load.week }, leastWeek, inputs.allotment),
    }))
    .sort(
      (a, b) =>
        Number(b.candidate.homeKnown) - Number(a.candidate.homeKnown) ||
        a.cost - b.cost ||
        a.candidate.load.day - b.candidate.load.day ||
        a.candidate.load.week - b.candidate.load.week,
    )
    .map(({ candidate, cost }) => ({
      technician: candidate.technician,
      addedDrive: candidate.addedDrive,
      cost,
      homeKnown: candidate.homeKnown,
      revision: candidate.revision,
    }));
}

/** Google's kept drives, each set of pins looked up once for the request: the starts in one gap share their drives. */
function keptOnce(): (points: readonly Point[]) => Promise<RouteResult | null> {
  const seen = new Map<string, Promise<RouteResult | null>>();
  return (points) => {
    const key = JSON.stringify(points);
    const found = seen.get(key) ?? keptDriveThrough(points);
    seen.set(key, found);
    return found;
  };
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
  const cityOf = { ...place, keeping: placing.moving?.technicianId ?? null };
  const reading = input.inputs === undefined ? readOpsInputs(db, now) : Promise.resolve(input.inputs);
  // The city's technicians' days are read beside who may take the visit, so the plans wait on no trip of their own.
  const [able, closed, clientVisits, pin, plans, inputs, radii] = await Promise.all([
    techniciansFor(db, placing.moving ?? null, place, visit.fitting ?? null),
    loadBlackouts(db, from, to, place),
    visitsOfClient(db, placing.personId, placing.moving?.visitId ?? placing.replacing ?? null),
    pinOfVisit(db, placing),
    loadDayPlans({
      db,
      technicianIds: null,
      cityOf,
      from: tieRange(from).from,
      to: tieRange(to).to,
      now,
      hours: reading.then((read) => read.workingHours),
      leaving: { ...placing.leaving, visitId: placing.moving?.visitId ?? placing.leaving?.visitId ?? null },
    }),
    reading,
    radiiIn(db, cityOf),
  ]);
  const where = standings(able.technicians, radii, { pin, keeping: placing.moving?.technicianId ?? null, inputs });
  const technicians = able.technicians.filter((technician) => where.has(technician.id));
  const rules = planRulesOf(inputs);
  const toPlan = { minutes: visit.minutes, pin, fit: visit.fitting !== null && visit.fitting !== undefined };
  const retired = (date: string) => visit.until !== undefined && visit.until !== null && date >= visit.until;
  const kept = keptOnce();
  return Promise.all(
    Array.from({ length: days }, async (_, index): Promise<DayStarts> => {
      const date = addDays(from, index);
      const earliest = earliestOn(date, visit, inputs, now);
      if (earliest === null || closed.has(date) || retired(date)) return { date, starts: [] };
      const byStart = new Map<number, Candidate[]>();
      let leastWeek = Infinity;
      for (const technician of technicians) {
        const day = plans.day(technician.id, date);
        if (day === null) continue;
        const load = loadOf(plans, technician.id, date);
        leastWeek = Math.min(leastWeek, load.week);
        for (const placed of placements(day, toPlan, rules, earliest)) {
          // A start Google's drive was already found to leave no room for is not offered (./drive-check.ts).
          const placing = { time: timeOf(placed.start), minutes: visit.minutes, pin };
          if (!(await keptDrivesFit({ day, rules, now }, placing, kept))) continue;
          const takers = byStart.get(placed.start) ?? [];
          takers.push({
            technician,
            addedDrive: placed.addedDrive,
            revision: plans.revision(technician.id, date),
            load,
            overflow: where.get(technician.id)?.standing === "overflow",
            piece: able.pieces.get(technician.id) ?? null,
            homeKnown: where.get(technician.id)?.homeKnown ?? true,
          });
          byStart.set(placed.start, takers);
        }
      }
      const barred = techniciansBarredOn(clientVisits, date);
      const starts = [...byStart.entries()]
        .sort(([a], [b]) => a - b)
        .map(([start, takers]): StartOffer => {
          const allowed = allowedTechnicians(takers, (taker) => barred.has(taker.technician.id));
          const time = timeOf(start);
          return { time, startsAt: indiaInstant(date, time), takers: bestFirst(allowed, inputs, leastWeek) };
        });
      return { date, starts };
    }),
  );
}
