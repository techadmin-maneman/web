// A city's draft visits on one day, re-planned and written (docs/decisions/0290-allotted-the-evening-before.md): the
// plan (src/policy/replan.ts) is read from the same days booking plans on, and each draft it gives to another
// technician is moved in one batch under the lock a move takes on the day it goes to, so a hold placed there since
// fails the batch and nothing is written; the next pass tries again. Nobody is told: the time is the client's own,
// and who is coming is named only once the evening's lock fixes it.

import { addDays, indiaInstant } from "../../lib/india-time.ts";
import type { PlanDay } from "../../policy/day-plan.ts";
import { replan, type Draft } from "../../policy/replan.ts";
import type { OpsInputs } from "../platform/ops-settings.ts";
import { visitUpkeep } from "../visits/visit-upkeep.ts";
import { loadDayPlans, type DayPlans } from "./day-plans.ts";
import {
  ableOnce,
  draftChanged,
  draftMove,
  DRAFT_COLUMNS,
  draftOpen,
  startOf,
  takersOf,
  weekOf,
  type DraftRow,
} from "./draft-moves.ts";
import { releaseDeadHolds } from "./hold-slot.ts";
import { planRulesOf } from "./start-offers.ts";
import type { Radius } from "./standings.ts";
import { tieRange } from "./technician-choice.ts";
import { visitsOfClients } from "./technician-rotation.ts";

/** A draft the plan gives to another technician. */
interface Move {
  readonly row: DraftRow;
  readonly to: string;
  readonly minutes: number;
}

/** A city's day as booking plans on it: its drafts, its technicians' days, drafts on them, and their homes. */
export interface CityDay {
  readonly rows: readonly DraftRow[];
  readonly plans: DayPlans;
  readonly days: ReadonlyMap<string, PlanDay>;
  readonly radii: ReadonlyMap<string, Radius>;
}

type DayInput = { readonly city: string; readonly date: string; readonly now: Date; readonly inputs: OpsInputs };

/** A city's day, India's, as booking plans on it; null where it has no draft to re-plan. */
export async function readDay(db: D1Database, input: DayInput): Promise<CityDay | null> {
  const rows = await draftsOf(db, input);
  return rows.length === 0 ? null : dayOf(db, input, rows);
}

/**
 * A city's day with its technicians' days, even with no draft left (./evening-check.ts, once drafts may have been
 * fixed meanwhile).
 */
export async function readWholeDay(db: D1Database, input: DayInput): Promise<CityDay> {
  return dayOf(db, input, await draftsOf(db, input));
}

/** The city's drafts on the day still open to a re-plan. */
async function draftsOf(db: D1Database, { city, date, now }: DayInput): Promise<DraftRow[]> {
  const { results: rows } = await db
    .prepare(
      `SELECT ${DRAFT_COLUMNS} FROM appointments a
       WHERE a.window_start >= ?1 AND a.window_start < ?2 AND a.service_city = ?3 AND ${draftOpen("?4")}`,
    )
    .bind(
      indiaInstant(date, "00:00").toISOString(),
      indiaInstant(addDays(date, 1), "00:00").toISOString(),
      city,
      now.toISOString(),
    )
    .all<DraftRow>();
  return rows;
}

/** The day around its drafts: the city's active technicians, and each one's day as booking plans it. */
async function dayOf(db: D1Database, { city, date, now, inputs }: DayInput, rows: DraftRow[]): Promise<CityDay> {
  const { results: crewRows } = await db
    .prepare("SELECT id, home_lat, home_lng, radius_km FROM technicians WHERE city = ?1 AND active = 1")
    .bind(city)
    .all<Radius>();
  const plans = await loadDayPlans({
    db,
    technicianIds: [...new Set([...crewRows.map((each) => each.id), ...rows.map((each) => each.technician_id)])],
    from: tieRange(date).from,
    to: tieRange(date).to,
    now,
    inputs,
  });
  const radii = new Map(crewRows.map((each) => [each.id, each]));
  const days = new Map<string, PlanDay>();
  for (const id of new Set([...radii.keys(), ...rows.map((each) => each.technician_id)])) {
    const day = plans.day(id, date);
    if (day !== null) days.set(id, day);
  }
  return { rows, plans, days, radii };
}

/**
 * Re-plans a city's drafts on `date`, India's, and writes what changed; how many drafts moved. `ruledOut` names, by
 * draft, the technicians who may not keep or take it.
 */
export async function replanDay(
  db: D1Database,
  input: {
    readonly city: string;
    readonly date: string;
    readonly now: Date;
    readonly inputs: OpsInputs;
    readonly ruledOut?: ReadonlyMap<string, ReadonlySet<string>>;
  },
): Promise<number> {
  const { date, now, inputs } = input;
  const read = await readDay(db, input);
  if (read === null) return 0;
  const { rows, plans, days, radii } = read;
  const working = new Set(days.keys());
  const able = ableOnce(db);
  const visitsOf = await visitsOfClients(
    db,
    rows.flatMap((row) => row.person_id ?? []),
  );

  const drafts: Draft[] = [];
  for (const row of rows) {
    const start = startOf(row);
    const day = days.get(row.technician_id);
    const stop = day?.stops.find((each) => each.start === start);
    if (day === undefined || stop === undefined) continue;
    const found = { able: await able(row), visits: visitsOf(row.person_id, row.id), date };
    const ruledOut = input.ruledOut?.get(row.id) ?? new Set<string>();
    drafts.push({
      id: row.id,
      stop,
      technicianId: row.technician_id,
      takers: takersOf(row, { radii, working, inputs, ruledOut }, found),
    });
  }
  // Each day without its drafts: what is fixed on it, which the plan places the drafts around.
  const fixed = new Map<string, PlanDay>();
  for (const [id, day] of days) {
    const own = new Set(drafts.filter((each) => each.technicianId === id).map((each) => each.stop));
    fixed.set(id, { ...day, stops: day.stops.filter((stop) => !own.has(stop)) });
  }
  const weekMinutes = new Map<string, number>();
  for (const id of fixed.keys()) {
    const own = drafts.filter((each) => each.technicianId === id);
    weekMinutes.set(id, weekOf(plans, id, date) - own.reduce((sum, each) => sum + each.stop.end - each.stop.start, 0));
  }
  const plan = replan({
    drafts,
    crew: { days: fixed, weekMinutes },
    rules: planRulesOf(inputs),
    allotment: inputs.allotment,
  });

  const moves: Move[] = drafts.flatMap((draft) => {
    const to = plan.get(draft.id);
    const row = rows.find((each) => each.id === draft.id);
    return to === undefined || to === draft.technicianId || row === undefined
      ? []
      : [{ row, to, minutes: draft.stop.end - draft.stop.start }];
  });
  if (moves.length === 0) return 0;
  return (await writeMoves(db, { moves, plans, date }, now)) ? moves.length : 0;
}

/**
 * The moves in one batch (draftMove): holds nobody is paying for let go first, one lock a day however many drafts the
 * batch gives a technician, and the visits' upkeep after. A batch that fails for a change since writes nothing; false
 * then, for the next pass.
 */
async function writeMoves(
  db: D1Database,
  work: { readonly moves: readonly Move[]; readonly plans: DayPlans; readonly date: string },
  now: Date,
): Promise<boolean> {
  const at = now.toISOString();
  const locked = new Set<string>();
  const statements: D1PreparedStatement[] = [...releaseDeadHolds(db, now)];
  for (const { row, to } of work.moves) {
    const revision = work.plans.revision(to, work.date);
    const move = draftMove(db, { row, to, date: work.date, revision, lock: !locked.has(to) }, at);
    locked.add(to);
    statements.push(...move.statements);
  }
  statements.push(...visitUpkeep(db, { visits: work.moves.map((each) => each.row.id) }, at));
  try {
    await db.batch(statements);
    return true;
  } catch (error) {
    if (draftChanged(error)) return false;
    throw error;
  }
}
