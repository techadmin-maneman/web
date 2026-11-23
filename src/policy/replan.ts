// The re-plan of a day's draft visits (docs/decisions/0290-allotted-the-evening-before.md): each keeps the time its
// client was promised, and the plan only changes who takes it, to cost least in all (./allotment.ts). It starts from
// who has each now, and keeps any move of a draft to another technician, or swap of two drafts between technicians,
// that costs less and still fits both days, until none does. A draft whose own day no longer fits starts with nobody,
// so the plan moves it wherever it fits.

import type { Allotment, Piece } from "./allotment.ts";
import { dayDrive, placedAt, type PlanDay, type PlanRules, type Stop } from "./day-plan.ts";

/**
 * What a technician taking a draft costs beside the driving: whether it is in their ring, where its piece is, and
 * whether their home is known, without which nobody can tell what they would drive.
 */
export interface Taking {
  readonly overflow: boolean;
  readonly piece: Piece | null;
  readonly homeKnown: boolean;
}

export interface Draft {
  readonly id: string;
  /** Its promised time and place on the day. */
  readonly stop: Stop;
  /** Who has it now. */
  readonly technicianId: string;
  /** Who may take it: in the city, trained where it is a fit, within their ring, and allowed by the rotation. */
  readonly takers: ReadonlyMap<string, Taking>;
}

interface Crew {
  /** Each technician working the day, with what is fixed on it: the drafts left out. */
  readonly days: ReadonlyMap<string, PlanDay>;
  /** Minutes booked over the week around the day, the day's drafts left out. */
  readonly weekMinutes: ReadonlyMap<string, number>;
}

/**
 * What a draft costs left with a technician who may no longer take it, as when Google's drive leaves their day no room:
 * more than any day's driving, so the plan moves it wherever it fits.
 */
const UNTAKEN = 10_000;

/**
 * What a draft costs with a technician whose home is not set: their driving counts nothing, so this keeps them after
 * everyone whose home is known, as booking does (src/domain/booking/start-offers.ts), unless nobody else can take it.
 */
const NO_HOME = 1_000;

/** The most times the plan goes over every move and swap; a day's drafts settle in two or three. */
const PASSES = 6;

/** Who has a draft the plan has yet to place: nobody, which costs it UNTAKEN. */
const NOBODY = "";

type Plan = Map<string, string>;

/** What a re-plan of one day weighs. */
interface Planning {
  readonly drafts: readonly Draft[];
  readonly crew: Crew;
  readonly rules: PlanRules;
  readonly allotment: Allotment;
}

function pieceCost(piece: Piece | null, allotment: Allotment): number {
  if (piece === "stockroom") return allotment.stockroom_cost;
  if (piece === "none") return allotment.no_piece_cost;
  return 0;
}

/** A technician's day with the drafts the plan gives them; null where they do not all fit. */
function dayWith(technicianId: string, plan: Plan, { drafts, crew, rules }: Planning) {
  const fixed = crew.days.get(technicianId);
  if (fixed === undefined) return null;
  let day: PlanDay = fixed;
  for (const draft of drafts) {
    if (plan.get(draft.id) !== technicianId) continue;
    const visit = { minutes: draft.stop.end - draft.stop.start, pin: draft.stop.pin, fit: draft.stop.fit };
    if (placedAt(day, visit, draft.stop.start, rules) === null) return null;
    day = { ...day, stops: [...day.stops, draft.stop] };
  }
  return day;
}

/**
 * What the plan costs in all, in minutes of driving: every working day's driving, each draft's ring and piece where it
 * goes, and each hour a technician's week holds past the least booked one's; null where a day does not fit.
 */
function costOf(plan: Plan, planning: Planning) {
  const { drafts, crew, rules, allotment } = planning;
  let total = 0;
  const weeks = new Map(crew.weekMinutes);
  for (const technicianId of crew.days.keys()) {
    const day = dayWith(technicianId, plan, planning);
    if (day === null) return null;
    total += dayDrive(day, rules);
  }
  for (const draft of drafts) {
    const technicianId = plan.get(draft.id) ?? draft.technicianId;
    const taking = draft.takers.get(technicianId);
    if (taking === undefined) total += UNTAKEN;
    else if (!taking.homeKnown) total += NO_HOME;
    total += (taking?.overflow === true ? allotment.overflow_cost : 0) + pieceCost(taking?.piece ?? null, allotment);
    weeks.set(technicianId, (weeks.get(technicianId) ?? 0) + draft.stop.end - draft.stop.start);
  }
  const working = [...crew.days.keys()].map((id) => weeks.get(id) ?? 0);
  const least = Math.min(...working);
  for (const minutes of working) total += ((minutes - least) / 60) * allotment.share_cost;
  return total;
}

/**
 * The drafts a technician had on a day that no longer fits as it stands: they are away all of it, or leave, shorter
 * hours or a lower cap has since been laid over it. Each starts with nobody, and goes back to them only where it fits.
 */
function strandedOn(whole: Planning): ReadonlySet<string> {
  const own: Plan = new Map(whole.drafts.map((draft) => [draft.id, draft.technicianId]));
  const unfit = new Set(
    whole.drafts
      .map((draft) => draft.technicianId)
      .filter((id) => !whole.crew.days.has(id) || dayWith(id, own, whole) === null),
  );
  return new Set(whole.drafts.filter((draft) => unfit.has(draft.technicianId)).map((draft) => draft.id));
}

/**
 * Who takes each of the day's drafts, by the draft's ID: the plan that costs least of those its moves reach; null for a
 * draft whose own day no longer fits it and nobody else can take.
 */
export function replan(planning: Planning): Map<string, string | null> {
  const { drafts, crew } = planning;
  const stranded = strandedOn(planning);
  const plan: Plan = new Map(drafts.map((draft) => [draft.id, stranded.has(draft.id) ? NOBODY : draft.technicianId]));
  const placed = () =>
    new Map([...plan].map(([id, technicianId]) => [id, technicianId === NOBODY ? null : technicianId]));
  let best = costOf(plan, planning);
  if (best === null) return placed();
  const tryPlan = (next: Plan): boolean => {
    const cost = costOf(next, planning);
    if (cost === null || cost >= (best ?? 0) - 0.5) return false;
    best = cost;
    for (const [id, technicianId] of next) plan.set(id, technicianId);
    return true;
  };
  for (let pass = 0; pass < PASSES; pass += 1) {
    let changed = false;
    for (const draft of drafts) {
      for (const technicianId of draft.takers.keys()) {
        if (technicianId === plan.get(draft.id) || !crew.days.has(technicianId)) continue;
        changed = tryPlan(new Map(plan).set(draft.id, technicianId)) || changed;
      }
    }
    for (const [index, first] of drafts.entries()) {
      for (const second of drafts.slice(index + 1)) {
        const [a, b] = [plan.get(first.id) ?? "", plan.get(second.id) ?? ""];
        if (a === b || !first.takers.has(b) || !second.takers.has(a)) continue;
        changed = tryPlan(new Map(plan).set(first.id, b).set(second.id, a)) || changed;
      }
    }
    if (!changed) break;
  }
  return placed();
}
