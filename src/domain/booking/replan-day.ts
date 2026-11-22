// A city's draft visits on one day, re-planned and written (docs/decisions/0290-allotted-the-evening-before.md): the
// plan (src/policy/replan.ts) is read from the same days booking plans on, and each draft it gives to another
// technician is moved in one batch under the lock a move takes on the day it goes to, so a hold placed there since
// fails the batch and nothing is written; the next pass tries again. Nobody is told: the time is the client's own,
// and who is coming is named only once the evening's lock fixes it.

import { statusIn, VISIT_NOT_BEGUN } from "../../config/statuses.ts";
import { failedNotNullOn, failedUniqueOn } from "../../lib/d1-errors.ts";
import { CLIENT_MOVING } from "./hold-stages.ts";
import { releaseDeadHolds } from "./hold-slot.ts";
import type { VisitType } from "../../config/visit-types.ts";
import { addDays, indiaInstant, indiaTime } from "../../lib/india-time.ts";
import { minuteOf, type PlanDay } from "../../policy/day-plan.ts";
import { replan, type Draft, type Taking } from "../../policy/replan.ts";
import { allowedTechnicians, techniciansBarredOn } from "../../policy/technician-rotation.ts";
import type { OpsInputs } from "../platform/ops-settings.ts";
import { reallottingDraft } from "../visits/technician-draft.ts";
import { visitUpkeep } from "../visits/visit-upkeep.ts";
import { loadDayPlans, type DayPlans } from "./day-plans.ts";
import { fittingOf, techniciansFor } from "./occupancy.ts";
import { pinColumns, planRulesOf, standings, type Radius } from "./start-offers.ts";
import { tieRange } from "./technician-choice.ts";
import { visitsOfClients } from "./technician-rotation.ts";
import type { ClientVisit } from "../../policy/technician-rotation.ts";
import { hasOpenProposal } from "../visits/open-proposals.ts";

export interface DraftRow {
  readonly id: string;
  readonly person_id: string | null;
  readonly type: VisitType | null;
  readonly tier: string | null;
  readonly window_start: string;
  readonly technician_id: string;
  readonly service_pincode: string | null;
  /** Where it is (./start-offers.ts pinColumns); null where neither the client nor the pincode has a pin. */
  readonly lat: number | null;
  readonly lng: number | null;
  /** Whether its client is one of staging's test records, who is booked only with a test technician. */
  readonly test_record: number | null;
}

/** Who a draft could go to, as booking reads it (./occupancy.ts). */
type Able = Awaited<ReturnType<typeof techniciansFor>>;

/** A draft the plan gives to another technician. */
interface Move {
  readonly row: DraftRow;
  readonly to: string;
  readonly minutes: number;
}

/** Minutes booked on a technician's days over the week around `date`. */
function weekOf(plans: DayPlans, technicianId: string, date: string): number {
  let minutes = 0;
  for (let day = tieRange(date).from; day <= tieRange(date).to; day = addDays(day, 1)) {
    for (const stop of plans.day(technicianId, day)?.stops ?? []) minutes += stop.end - stop.start;
  }
  return minutes;
}

/**
 * Who could take each draft, read once for each pincode and kind of client among the drafts that fit nothing, which
 * nothing else of the client's changes; and for each fit, by its client's piece.
 */
function ableOnce(db: D1Database): (row: DraftRow) => Promise<Able> {
  const read = new Map<string, Promise<Able>>();
  return (row) => {
    const fitting = fittingOf(row.type, row.tier);
    const place = { pincode: row.service_pincode, personId: row.person_id };
    if (fitting !== null) return techniciansFor(db, null, place, fitting);
    const key = `${row.service_pincode ?? ""}|${String(row.test_record)}`;
    const known = read.get(key) ?? techniciansFor(db, null, place);
    read.set(key, known);
    return known;
  };
}

/** Who may take a draft, as booking would offer it: in the city, trained, in their ring, allowed by the rotation. */
function takersOf(
  row: DraftRow,
  read: {
    readonly radii: ReadonlyMap<string, Radius>;
    readonly working: ReadonlySet<string>;
    readonly inputs: OpsInputs;
    /** Who may no longer take it, Google's drive having left their day no room for it (./evening-check.ts). */
    readonly ruledOut: ReadonlySet<string>;
  },
  found: { readonly able: Able; readonly visits: readonly ClientVisit[]; readonly date: string },
): Map<string, Taking> {
  const { able, visits, date } = found;
  const pin = row.lat === null || row.lng === null ? null : { lat: row.lat, lng: row.lng };
  const where = standings(able.technicians, read.radii, { pin, keeping: null, inputs: read.inputs });
  const barred = techniciansBarredOn(visits, date);
  const allowed = allowedTechnicians(
    able.technicians.filter((each) => where.has(each.id) && read.working.has(each.id) && !read.ruledOut.has(each.id)),
    (each) => barred.has(each.id),
  );
  const homeKnown = (id: string) => {
    const radius = read.radii.get(id);
    if (radius === undefined) return false;
    return radius.home_lat !== null && radius.home_lng !== null;
  };
  // Who has it now may keep it, so the plan starts from one that fits, unless Google's drive ruled them out.
  const takers = new Map<string, Taking>();
  if (!read.ruledOut.has(row.technician_id)) {
    takers.set(row.technician_id, { overflow: false, piece: null, homeKnown: homeKnown(row.technician_id) });
  }
  for (const each of allowed) {
    takers.set(each.id, {
      overflow: where.get(each.id)?.standing === "overflow",
      piece: able.pieces.get(each.id) ?? null,
      homeKnown: homeKnown(each.id),
    });
  }
  return takers;
}

/** A city's day as booking plans on it: its drafts, its technicians' days, drafts on them, and their homes. */
export interface CityDay {
  readonly rows: readonly DraftRow[];
  readonly plans: DayPlans;
  readonly days: ReadonlyMap<string, PlanDay>;
  readonly radii: ReadonlyMap<string, Radius>;
}

/**
 * A city's day, India's, as booking plans on it; null where it has no draft to re-plan, unless `evenWithoutDrafts`
 * asks for its technicians' days all the same (./evening-check.ts, once drafts may have been fixed meanwhile).
 */
export async function readDay(
  db: D1Database,
  input: { readonly city: string; readonly date: string; readonly now: Date; readonly inputs: OpsInputs },
  { evenWithoutDrafts = false }: { readonly evenWithoutDrafts?: boolean } = {},
): Promise<CityDay | null> {
  const { city, date, now, inputs } = input;
  const { results: rows } = await db
    .prepare(
      `SELECT a.id, a.person_id, a.type, a.tier, a.window_start, a.technician_id, a.service_pincode,
         ${pinColumns("a.person_id", "a.service_pincode")},
         (SELECT p.test_record FROM people p WHERE p.id = a.person_id) AS test_record
       FROM appointments a
       WHERE a.technician_draft = 1 AND a.window_start >= ?1 AND a.window_start < ?2 AND a.service_city = ?3
         AND a.deleted_at IS NULL AND a.technician_id IS NOT NULL AND ${statusIn("a.status", VISIT_NOT_BEGUN)}
         AND NOT ${CLIENT_MOVING} AND NOT ${hasOpenProposal("a", "?4")}`,
    )
    .bind(
      indiaInstant(date, "00:00").toISOString(),
      indiaInstant(addDays(date, 1), "00:00").toISOString(),
      city,
      now.toISOString(),
    )
    .all<DraftRow>();
  if (rows.length === 0 && !evenWithoutDrafts) return null;
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
    hours: inputs.workingHours,
  });
  const radii = new Map(crewRows.map((each) => [each.id, each]));
  const days = new Map<string, PlanDay>();
  for (const id of new Set([...radii.keys(), ...rows.map((each) => each.technician_id)])) {
    const day = plans.day(id, date);
    if (day !== null) days.set(id, day);
  }
  return { rows, plans, days, radii };
}

/** The start of a draft on its day, in minutes from midnight, as its stop there begins. */
export const startOf = (row: Pick<DraftRow, "window_start">): number => minuteOf(indiaTime(new Date(row.window_start)));

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
 * The moves in one batch, as a move on the board is written (ADR 0069): holds nobody is paying for let go, each move
 * recorded, the day it goes to locked one past the last lock a hold took, the visit given to its new technician while
 * still the draft as read, and the locks let go. A hold placed on that day since, a draft fixed or moved since, or a
 * client's own move of it waiting on payment, fails the batch and nothing is written; false then, for the next pass.
 */
async function writeMoves(
  db: D1Database,
  work: { readonly moves: readonly Move[]; readonly plans: DayPlans; readonly date: string },
  now: Date,
): Promise<boolean> {
  const at = now.toISOString();
  const locked = new Set<string>();
  const statements: D1PreparedStatement[] = [...releaseDeadHolds(db, now)];
  const ids: string[] = [];
  for (const { row, to } of work.moves) {
    const moveId = crypto.randomUUID();
    ids.push(moveId);
    statements.push(
      db
        .prepare(
          `INSERT INTO dispatch_moves (id, appointment_id, was_technician_id, now_technician_id, was_start, now_start,
             reason, actor, fsm_write_state, write_state, created_at, updated_at)
           VALUES (?1,
             (SELECT a.id FROM appointments a
              WHERE a.id = ?2 AND a.technician_id IS ?3 AND a.window_start = ?5 AND a.technician_draft = 1
                AND a.deleted_at IS NULL AND ${statusIn("a.status", VISIT_NOT_BEGUN)} AND NOT ${CLIENT_MOVING}
                AND NOT ${hasOpenProposal("a", "?6")}),
             ?3, ?4, ?5, ?5, 'zone_rebalance', 'allotment', 'written', 'written', ?6, ?6)`,
        )
        .bind(moveId, row.id, row.technician_id, to, row.window_start, at),
    );
    // One lock a day, however many drafts the batch gives that technician.
    if (!locked.has(to)) {
      statements.push(
        db
          .prepare("INSERT INTO slot_claims (technician_id, date, claim, move_id) VALUES (?1, ?2, ?3, ?4)")
          .bind(to, work.date, `rev:${String(work.plans.revision(to, work.date) + 1)}`, moveId),
      );
      locked.add(to);
    }
    statements.push(reallottingDraft(db, { visitId: row.id, technicianId: to, at }));
  }
  for (const moveId of ids) {
    statements.push(db.prepare("DELETE FROM slot_claims WHERE move_id = ?1").bind(moveId));
  }
  statements.push(...visitUpkeep(db, { visits: work.moves.map((each) => each.row.id) }, at));
  try {
    await db.batch(statements);
    return true;
  } catch (error) {
    if (failedUniqueOn(error, "slot_claims") || failedNotNullOn(error, "dispatch_moves.appointment_id")) return false;
    throw error;
  }
}
