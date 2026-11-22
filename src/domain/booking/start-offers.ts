// The starts a visit may be booked at (docs/decisions/0210-booking-by-start-time.md): each day's starts a step apart
// that some technician in the visit's city can take, and who, best first. Best is whoever's home is known, then whoever
// the visit costs least (src/policy/allotment.ts), then whoever has the least booked that day, then over the week.
//
// Today is offered from the lead time on, and only for a kind of visit ops let clients book for today. A day ops
// black out, or from the day a service is retired on, is offered to nobody; and no technician who took the client's
// visit just before or just after that day takes it, unless nobody else can. A start nobody can take is offered where
// moving one draft to another technician makes room for it (./make-room.ts).

import type { VisitType } from "../../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant, indiaTime } from "../../lib/india-time.ts";
import type { Pin } from "../../lib/geo.ts";
import { minuteOf, placements, timeOf, type PlanDay, type PlanRules, type VisitToPlan } from "../../policy/day-plan.ts";
import { allowedTechnicians, techniciansBarredOn } from "../../policy/technician-rotation.ts";
import { costOf, type Piece } from "../../policy/allotment.ts";
import { readOpsInputs, type OpsInputs } from "../platform/ops-settings.ts";
import { tieRange } from "./technician-choice.ts";
import { loadDayPlans, type CityOf, type DayPlans, type Leaving } from "./day-plans.ts";
import { bookingCity, loadBlackouts, techniciansFor, type Fitting, type Moving, type Technician } from "./occupancy.ts";
import { visitsOfClient } from "./technician-rotation.ts";
import { roomOn, type Room } from "./make-room.ts";
import { leftToTheLock, reminderHoursAt } from "./allotment-lock.ts";
import { pinColumns, standings, type Placing, type Radius } from "./standings.ts";
import { draftsOf, type DraftRow } from "./draft-moves.ts";
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
  /** The draft the hold moves to make room for this taker, where nobody could take the start without. */
  readonly room?: Room;
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
export async function pinOfVisit(
  db: D1Database,
  placing: Pick<StartPlacing, "personId" | "pincode">,
): Promise<Pin | null> {
  const row = await db
    .prepare(`SELECT ${pinColumns("?1", "?2")}`)
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

/** Each home and radius of the technicians of the visit's city, read beside who may take it rather than after. */
async function radiiIn(db: D1Database, cityOf: CityOf): Promise<ReadonlyMap<string, Radius>> {
  const { results } = await db
    .prepare(`SELECT id, home_lat, home_lng, radius_km FROM technicians WHERE city = ${bookingCity("?1", "?2")}`)
    .bind(cityOf.pincode, cityOf.personId)
    .all<Radius>();
  return new Map(results.map((row) => [row.id, row]));
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
  readonly room?: Room;
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
      ...(candidate.room === undefined ? {} : { room: candidate.room }),
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

/** Whether a draft's visit falls on India's `date`. */
const onDay = (row: { readonly window_start: string }, date: string) => indiaDate(new Date(row.window_start)) === date;

/** What each day's starts are read from, once for every day asked for. */
interface Offering {
  readonly db: D1Database;
  readonly now: Date;
  readonly visit: StartVisit;
  readonly toPlan: VisitToPlan;
  readonly technicians: readonly Technician[];
  readonly plans: DayPlans;
  readonly inputs: OpsInputs;
  readonly where: ReadonlyMap<string, Placing>;
  readonly pieces: ReadonlyMap<string, Piece>;
  readonly clientVisits: Awaited<ReturnType<typeof visitsOfClient>>;
  readonly drafts: readonly DraftRow[];
  readonly radii: ReadonlyMap<string, Radius>;
  readonly kept: ReturnType<typeof keptOnce>;
  /**
   * Whether a start nobody can take may be freed by moving a draft: not where the days are read without a visit, as for
   * a client's move, since the draft would be placed where that visit still stands.
   */
  readonly makesRoom: boolean;
}

/** A technician who can take a start on `date`, as the start's list carries them. */
function candidateOf(
  offering: Offering,
  on: { readonly technician: Technician; readonly date: string; readonly addedDrive: number; readonly room?: Room },
): Candidate {
  const { technician, date } = on;
  const placing = offering.where.get(technician.id);
  return {
    technician,
    addedDrive: on.addedDrive,
    revision: offering.plans.revision(technician.id, date),
    load: loadOf(offering.plans, technician.id, date),
    overflow: placing?.standing === "overflow",
    piece: offering.pieces.get(technician.id) ?? null,
    homeKnown: placing?.homeKnown ?? true,
    ...(on.room === undefined ? {} : { room: on.room }),
  };
}

/**
 * A day's starts some technician can take, and who, best first; then those nobody could take that moving one draft
 * makes room for (./make-room.ts).
 */
async function startsOn(offering: Offering, date: string, earliest: number): Promise<StartOffer[]> {
  const { db, now, visit, toPlan, plans, inputs, kept } = offering;
  const rules = planRulesOf(inputs);
  // A start Google's drive was already found to leave no room for is not offered (./drive-check.ts).
  const drivesFit = (day: PlanDay, start: number) =>
    keptDrivesFit({ day, rules, now }, { time: timeOf(start), minutes: visit.minutes, pin: toPlan.pin }, kept);
  const byStart = new Map<number, Candidate[]>();
  let leastWeek = Infinity;
  for (const technician of offering.technicians) {
    const day = plans.day(technician.id, date);
    if (day === null) continue;
    leastWeek = Math.min(leastWeek, loadOf(plans, technician.id, date).week);
    for (const placed of placements(day, toPlan, rules, earliest)) {
      if (!(await drivesFit(day, placed.start))) continue;
      const candidate = candidateOf(offering, { technician, date, addedDrive: placed.addedDrive });
      byStart.set(placed.start, [...(byStart.get(placed.start) ?? []), candidate]);
    }
  }
  const drafts = offering.makesRoom ? offering.drafts.filter((row) => onDay(row, date)) : [];
  const city = { date, drafts, plans, radii: offering.radii, rules };
  const booking = { technicians: offering.technicians, visit: toPlan, earliest, offered: new Set(byStart.keys()) };
  for (const [start, rooms] of await roomOn(db, { ...city, inputs }, { ...booking, drivesFit })) {
    byStart.set(
      start,
      rooms.map((room) => candidateOf(offering, { ...room, date })),
    );
  }
  const barred = techniciansBarredOn(offering.clientVisits, date);
  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, takers]): StartOffer => {
      const allowed = allowedTechnicians(takers, (taker) => barred.has(taker.technician.id));
      const time = timeOf(start);
      return { time, startsAt: indiaInstant(date, time), takers: bestFirst(allowed, inputs, leastWeek) };
    });
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
  const homes = radiiIn(db, cityOf);
  const makesRoom = (placing.moving?.visitId ?? placing.leaving?.visitId ?? null) === null;
  // The city's drafts a booking may move: none for a client's move, and none the evening's check and lock now hold.
  const movable = makesRoom
    ? Promise.all([homes, reminderHoursAt(db, now)]).then(async ([rows, hours]) =>
        (await draftsOf(db, { technicianIds: [...rows.keys()], from, to, now })).filter(
          (row) => !leftToTheLock(hours, { city: row.service_city, date: indiaDate(new Date(row.window_start)) }, now),
        ),
      )
    : Promise.resolve([]);
  // The city's technicians' days are read beside who may take the visit, so the plans wait on no trip of their own.
  const [able, closed, clientVisits, pin, plans, inputs, radii, drafts] = await Promise.all([
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
      inputs: reading,
      leaving: { ...placing.leaving, visitId: placing.moving?.visitId ?? placing.leaving?.visitId ?? null },
    }),
    reading,
    homes,
    movable,
  ]);
  const where = standings(able.technicians, radii, { pin, keeping: placing.moving?.technicianId ?? null, inputs });
  const offering: Offering = {
    db,
    now,
    visit,
    toPlan: { minutes: visit.minutes, pin, fit: visit.fitting !== null && visit.fitting !== undefined },
    technicians: able.technicians.filter((technician) => where.has(technician.id)),
    plans,
    inputs,
    where,
    pieces: able.pieces,
    clientVisits,
    drafts,
    radii,
    kept: keptOnce(),
    makesRoom,
  };
  const retired = (date: string) => visit.until !== undefined && visit.until !== null && date >= visit.until;
  return Promise.all(
    Array.from({ length: days }, async (_, index): Promise<DayStarts> => {
      const date = addDays(from, index);
      const earliest = earliestOn(date, visit, inputs, now);
      if (earliest === null || closed.has(date) || retired(date)) return { date, starts: [] };
      return { date, starts: await startsOn(offering, date, earliest) };
    }),
  );
}
