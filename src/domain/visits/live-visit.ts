// A visit as it happens, for the client (docs/decisions/0255-client-alerts-and-push.md): the technician's latest word
// before they arrive (on the way, running late, at the gate), how long they wait at the door once checked in, and the
// step of the visit they are on, by the plan both apps read (src/policy/visit-plan.ts). Nothing of where the
// technician is, nor their phone, is said.

import type { VisitType } from "../../config/visit-types.ts";
import { cardStepsFor } from "../../policy/in-job-steps.ts";
import { waitEndsAt, waitStartsAt, type Waits } from "../../policy/no-show.ts";
import { clientStepsOf, currentStep, planOf, type ClientStep } from "../../policy/visit-plan.ts";
import type { Preset } from "../messages/technician-updates.ts";

/** The technician's word, as the client's app names it. */
const UPDATE_KINDS: Readonly<Record<Preset, LiveUpdateKind>> = {
  on_the_way: "on_the_way",
  running_late: "running_late",
  at_gate: "at_the_gate",
};
export type LiveUpdateKind = "on_the_way" | "running_late" | "at_the_gate";

export interface LiveFacts {
  /** The technician's latest word, while they are still to arrive; null for none. */
  readonly latest_update: {
    readonly kind: LiveUpdateKind;
    readonly minutes: number | null;
    readonly at: string;
  } | null;
  /** The step of the visit the technician is on, while it is under way. */
  readonly step: { readonly index: number; readonly of: number; readonly name: ClientStep } | null;
  /** The last moment the technician waits at the door, once checked in and before the visit starts. */
  readonly waits_until: string | null;
}

/** What a visit's live facts are read from. */
export interface LiveVisitRow {
  readonly id: string;
  readonly type: VisitType | null;
  /** A consultation and fit in one visit. */
  readonly oneVisit: boolean;
  readonly startsAt: string;
  readonly stage: "booked" | "arrived" | "in_progress" | "done" | "closing" | "missed" | null;
}

const NONE: LiveFacts = { latest_update: null, step: null, waits_until: null };

interface Landed {
  readonly updates: Map<string, { preset: Preset; minutes: number | null; written_at: string }>;
  readonly steps: Map<string, Set<string>>;
  readonly checkIns: Map<string, string>;
}

/** The words, the steps landed and the check-ins of these visits, in one trip. */
async function landedFor(db: D1Database, ids: readonly string[]): Promise<Landed> {
  const marks = ids.map((_, at) => `?${String(at + 1)}`).join(", ");
  const [updates, events, profiles] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT appointment_id, preset, minutes, written_at FROM technician_updates
         WHERE appointment_id IN (${marks}) ORDER BY written_at DESC`,
      )
      .bind(...ids),
    db
      .prepare(
        `SELECT appointment_id, kind, MIN(occurred_at) AS at FROM job_events
         WHERE appointment_id IN (${marks}) AND superseded = 0 GROUP BY appointment_id, kind`,
      )
      .bind(...ids),
    db.prepare(`SELECT DISTINCT appointment_id FROM hair_profiles WHERE appointment_id IN (${marks})`).bind(...ids),
  ]);
  const landed: Landed = { updates: new Map(), steps: new Map(), checkIns: new Map() };
  for (const row of (updates?.results ?? []) as {
    appointment_id: string;
    preset: Preset;
    minutes: number | null;
    written_at: string;
  }[]) {
    if (!landed.updates.has(row.appointment_id)) landed.updates.set(row.appointment_id, row);
  }
  for (const row of (events?.results ?? []) as { appointment_id: string; kind: string; at: string }[]) {
    const kinds = landed.steps.get(row.appointment_id) ?? new Set<string>();
    kinds.add(row.kind);
    landed.steps.set(row.appointment_id, kinds);
    if (row.kind === "check_in") landed.checkIns.set(row.appointment_id, row.at);
  }
  for (const row of (profiles?.results ?? []) as { appointment_id: string }[]) {
    const kinds = landed.steps.get(row.appointment_id) ?? new Set<string>();
    kinds.add("profile");
    landed.steps.set(row.appointment_id, kinds);
  }
  return landed;
}

function factsOf(visit: LiveVisitRow, landed: Landed, waits: Waits): LiveFacts {
  const type = visit.type ?? "service";
  if (visit.stage === "booked") {
    const update = landed.updates.get(visit.id);
    return {
      ...NONE,
      latest_update:
        update === undefined
          ? null
          : { kind: UPDATE_KINDS[update.preset], minutes: update.minutes, at: update.written_at },
    };
  }
  if (visit.stage === "arrived") {
    const checkedIn = landed.checkIns.get(visit.id);
    if (checkedIn === undefined) return NONE;
    const ends = waitEndsAt(waitStartsAt(new Date(checkedIn), new Date(visit.startsAt)), type, waits);
    return { ...NONE, waits_until: ends.toISOString() };
  }
  if (visit.stage === "in_progress") {
    const plan = planOf({ type: visit.type, one_visit: visit.oneVisit });
    const steps = clientStepsOf(plan, new Set<string>(cardStepsFor(type, visit.oneVisit)));
    return { ...NONE, step: currentStep(steps, landed.steps.get(visit.id) ?? new Set()) };
  }
  return NONE;
}

/** Each visit's live facts, by its ID; a visit not under way, or closed, has none. */
export async function liveFactsOf(
  db: D1Database,
  visits: readonly LiveVisitRow[],
  waits: Waits,
): Promise<Map<string, LiveFacts>> {
  const live = visits.filter(
    (visit) => visit.stage === "booked" || visit.stage === "arrived" || visit.stage === "in_progress",
  );
  const facts = new Map(visits.map((visit) => [visit.id, NONE]));
  if (live.length === 0) return facts;
  const landed = await landedFor(
    db,
    live.map((visit) => visit.id),
  );
  for (const visit of live) facts.set(visit.id, factsOf(visit, landed, waits));
  return facts;
}
