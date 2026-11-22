// Room made at booking (docs/decisions/0292-room-made-at-booking.md): a start nobody can take is offered where a
// technician could take it once one of their drafts went to another technician who may take that draft at its promised
// time, as booking would offer it, and whose day still fits it: whoever's home is known first, then whoever it costs
// least, as booking weighs a taker (src/policy/allotment.ts). One draft moves for a start; the evening's re-plan and
// lock go on from there. The hold writes the move in its own batch (./hold-slot.ts), so a draft fixed or moved
// meanwhile fails the hold and nothing is written.

import { costOf } from "../../policy/allotment.ts";
import type { PlanDay, PlanRules, VisitToPlan } from "../../policy/day-plan.ts";
import { placedAt, placements } from "../../policy/day-plan.ts";
import type { OpsInputs } from "../platform/ops-settings.ts";
import type { DayPlans } from "./day-plans.ts";
import type { Technician } from "./occupancy.ts";
import { ableOnce, startOf, takersOf, weekOf, type DraftRow } from "./draft-moves.ts";
import type { Radius } from "./standings.ts";
import { visitsOfClients } from "./technician-rotation.ts";

/** A draft a hold moves to another technician, so the one who had it can take the hold's start. */
export interface Room {
  readonly draft: DraftRow;
  readonly to: string;
  /** The lock the move takes on the day it goes to, as that day was read. */
  readonly revision: number;
}

/** A technician who could take a start once a draft of theirs goes, the driving it adds, and the draft's move. */
export interface RoomTaker {
  readonly technician: Technician;
  readonly addedDrive: number;
  readonly room: Room;
}

/** What one day of the booking's city makes room on: its drafts, its technicians' days and homes, and the rules. */
export interface RoomDay {
  readonly date: string;
  readonly drafts: readonly DraftRow[];
  readonly plans: DayPlans;
  readonly radii: ReadonlyMap<string, Radius>;
  readonly rules: PlanRules;
  readonly inputs: OpsInputs;
}

/** The booking to make room for: who may take it, the visit, the day's earliest start, and the starts offered already. */
export interface RoomFor {
  readonly technicians: readonly Technician[];
  readonly visit: VisitToPlan;
  readonly earliest: number;
  readonly offered: ReadonlySet<number>;
  /** Whether Google's drives already found leave room for a start on a day (./drive-check.ts). */
  readonly drivesFit: (day: PlanDay, start: number) => Promise<boolean>;
}

/**
 * Who a draft goes to where its technician gives it up: whoever else may take it, as booking would offer it, and whose
 * day fits it at its time; whoever's home is known first, then whoever it costs least; null for nobody.
 */
async function goesTo(
  day: RoomDay,
  draft: { readonly row: DraftRow; readonly stop: PlanDay["stops"][number] },
  read: {
    readonly able: ReturnType<typeof ableOnce>;
    /** The drafts' clients' visits, read once a draft is found to make room. */
    readonly visits: () => ReturnType<typeof visitsOfClients>;
  },
): Promise<string | null> {
  const { row, stop } = draft;
  const working = new Set([...day.radii.keys()].filter((id) => day.plans.day(id, day.date) !== null));
  const takers = takersOf(
    row,
    { radii: day.radii, working, inputs: day.inputs, ruledOut: new Set([row.technician_id]) },
    { able: await read.able(row), visits: (await read.visits())(row.person_id, row.id), date: day.date },
  );
  const visit = { minutes: stop.end - stop.start, pin: stop.pin, fit: stop.fit };
  const options = [...takers].flatMap(([id, taking]) => {
    const theirs = day.plans.day(id, day.date);
    const placed = theirs === null ? null : placedAt(theirs, visit, stop.start, day.rules);
    if (placed === null) return [];
    const weekMinutes = weekOf(day.plans, id, day.date);
    return [{ id, homeKnown: taking.homeKnown, cost: { ...taking, addedDrive: placed.addedDrive, weekMinutes } }];
  });
  const leastWeek = Math.min(...options.map((option) => option.cost.weekMinutes));
  const costs = new Map(options.map((option) => [option.id, costOf(option.cost, leastWeek, day.inputs.allotment)]));
  options.sort((a, b) => Number(b.homeKnown) - Number(a.homeKnown) || (costs.get(a.id) ?? 0) - (costs.get(b.id) ?? 0));
  return options[0]?.id ?? null;
}

/**
 * The starts nobody could take on a day that a technician could once one of their drafts went to another, by start:
 * each such technician once, with the move that adds them least driving. A draft nobody else may take where it is
 * promised makes no room.
 */
export async function roomOn(db: D1Database, day: RoomDay, booking: RoomFor): Promise<Map<number, RoomTaker[]>> {
  const found = new Map<number, RoomTaker[]>();
  if (day.drafts.length === 0) return found;
  let clientVisits: ReturnType<typeof visitsOfClients> | null = null;
  const read = {
    able: ableOnce(db),
    visits: () => {
      clientVisits ??= visitsOfClients(
        db,
        day.drafts.flatMap((row) => row.person_id ?? []),
      );
      return clientVisits;
    },
  };
  const destination = new Map<string, Promise<string | null>>();
  for (const technician of booking.technicians) {
    const theirs = day.plans.day(technician.id, day.date);
    if (theirs === null) continue;
    for (const row of day.drafts.filter((each) => each.technician_id === technician.id)) {
      const stop = theirs.stops.find((each) => each.start === startOf(row));
      if (stop === undefined) continue;
      const without = { ...theirs, stops: theirs.stops.filter((each) => each !== stop) };
      const freed = placements(without, booking.visit, day.rules, booking.earliest).filter(
        (placed) => !booking.offered.has(placed.start),
      );
      if (freed.length === 0) continue;
      let going = destination.get(row.id);
      if (going === undefined) {
        going = goesTo(day, { row, stop }, read);
        destination.set(row.id, going);
      }
      const to = await going;
      if (to === null) continue;
      const room: Room = { draft: row, to, revision: day.plans.revision(to, day.date) };
      for (const placed of freed) {
        if (!(await booking.drivesFit(without, placed.start))) continue;
        const others = (found.get(placed.start) ?? []).filter((each) => each.technician.id !== technician.id);
        const theirs = found.get(placed.start)?.find((each) => each.technician.id === technician.id);
        const kept = theirs !== undefined && theirs.addedDrive <= placed.addedDrive;
        found.set(placed.start, [...others, kept ? theirs : { technician, addedDrive: placed.addedDrive, room }]);
      }
    }
  }
  return found;
}
