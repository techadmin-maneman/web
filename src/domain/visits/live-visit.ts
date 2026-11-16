// A visit as it happens, for the client (docs/decisions/0255-client-alerts-and-push.md): the technician's latest word
// before they arrive (on the way, running late, at the gate), how long they wait at the door once checked in, and the
// step of the visit they are on, by the plan both apps read (src/policy/visit-plan.ts). Nothing of where the
// technician is, nor their phone, is said.

import type { VisitType } from "../../config/visit-types.ts";
import { cardStepsFor } from "../../policy/in-job-steps.ts";
import { waitEndsAt, waitStartsAt, type Waits } from "../../policy/no-show.ts";
import { clientStepsOf, currentStep, planOf, type ClientStep } from "../../policy/visit-plan.ts";
import { stillHelps, type Preset } from "../messages/technician-updates.ts";
import { signOffsOf, type SignOff } from "../field/sign-offs.ts";
import { closesFit } from "../../policy/sign-off.ts";
import { profiledVisitsStatement } from "../clients/hair-profiles.ts";

/** The technician's word, as the client's app names it. */
const UPDATE_KINDS: Readonly<Record<Preset, LiveUpdateKind>> = {
  on_the_way: "on_the_way",
  running_late: "running_late",
  at_gate: "at_the_gate",
};
export const LIVE_UPDATE_KINDS = ["on_the_way", "running_late", "at_the_gate"] as const;
export type LiveUpdateKind = (typeof LIVE_UPDATE_KINDS)[number];

/** A technician's word as the phone recorded it, named as the client's app names it. */
export const liveUpdateKindOf = (preset: Preset): LiveUpdateKind => UPDATE_KINDS[preset];

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
  /** The fit's sign-off while the visit is under way: asked, flagged, signed or declined; null before it is asked. */
  readonly sign_off: SignOff | null;
}

/** What a visit's live facts are read from. */
export interface LiveVisitRow {
  readonly id: string;
  readonly type: VisitType | null;
  /** A consultation and fit in one visit. */
  readonly oneVisit: boolean;
  readonly startsAt: string;
  /** The technician on the visit now: a word from one it was taken from is not theirs to say. */
  readonly technicianId: string | null;
  readonly stage: "booked" | "arrived" | "in_progress" | "done" | "closing" | "missed" | null;
}

const NONE: LiveFacts = { latest_update: null, step: null, waits_until: null, sign_off: null };

interface Landed {
  readonly updates: Map<string, { preset: Preset; minutes: number | null; written_at: string; technician_id: string }>;
  readonly steps: Map<string, Set<string>>;
  readonly checkIns: Map<string, string>;
  readonly signOffs: Map<string, SignOff>;
}

/** The words, the steps landed, the check-ins and the sign-offs of these visits. */
async function landedFor(db: D1Database, ids: readonly string[]): Promise<Landed> {
  const marks = ids.map((_, at) => `?${String(at + 1)}`).join(", ");
  // One trip: the words, the steps and the profiles in a batch, beside the sign-offs.
  const [[updates, events, profiles], signOffs] = await Promise.all([
    db.batch<Record<string, unknown>>([
      db
        .prepare(
          `SELECT appointment_id, technician_id, preset, minutes, written_at FROM technician_updates
           WHERE appointment_id IN (${marks}) ORDER BY written_at DESC`,
        )
        .bind(...ids),
      db
        .prepare(
          `SELECT appointment_id, kind, MIN(occurred_at) AS at FROM job_events
           WHERE appointment_id IN (${marks}) AND superseded = 0 GROUP BY appointment_id, kind`,
        )
        .bind(...ids),
      profiledVisitsStatement(db, ids),
    ]),
    signOffsOf(db, ids),
  ]);
  const landed: Landed = { updates: new Map(), steps: new Map(), checkIns: new Map(), signOffs };
  for (const row of (updates?.results ?? []) as {
    appointment_id: string;
    technician_id: string;
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
  const mark = (rows: unknown[] | undefined, step: string) => {
    for (const row of (rows ?? []) as { appointment_id: string }[]) {
      const kinds = landed.steps.get(row.appointment_id) ?? new Set<string>();
      kinds.add(step);
      landed.steps.set(row.appointment_id, kinds);
    }
  };
  mark(profiles?.results, "profile");
  const closed = [...signOffs]
    .filter(([, signOff]) => closesFit(signOff.state))
    .map(([id]) => ({ appointment_id: id }));
  mark(closed, "sign_off");
  return landed;
}

/** The technician's latest word, while it is the visit's technician's and still tells the client something. */
function wordOf(visit: LiveVisitRow, landed: Landed, now: Date): LiveFacts["latest_update"] {
  const update = landed.updates.get(visit.id);
  if (update?.technician_id !== visit.technicianId) return null;
  if (!stillHelps(update.preset, new Date(update.written_at), now)) return null;
  return { kind: UPDATE_KINDS[update.preset], minutes: update.minutes, at: update.written_at };
}

function factsOf(visit: LiveVisitRow, landed: Landed, at: { readonly waits: Waits; readonly now: Date }): LiveFacts {
  const type = visit.type ?? "service";
  if (visit.stage === "booked") return { ...NONE, latest_update: wordOf(visit, landed, at.now) };
  if (visit.stage === "arrived") {
    const checkedIn = landed.checkIns.get(visit.id);
    if (checkedIn === undefined) return NONE;
    const ends = waitEndsAt(waitStartsAt(new Date(checkedIn), new Date(visit.startsAt)), type, at.waits);
    return { ...NONE, waits_until: ends.toISOString() };
  }
  if (visit.stage === "in_progress") {
    const plan = planOf({ type: visit.type, one_visit: visit.oneVisit });
    const steps = clientStepsOf(plan, new Set<string>(cardStepsFor(type, visit.oneVisit)));
    return {
      ...NONE,
      step: currentStep(steps, landed.steps.get(visit.id) ?? new Set()),
      sign_off: landed.signOffs.get(visit.id) ?? null,
    };
  }
  return NONE;
}

/** Each visit's live facts, by its ID; a visit not under way, or closed, has none. */
export async function liveFactsOf(
  db: D1Database,
  visits: readonly LiveVisitRow[],
  at: { readonly waits: Waits; readonly now: Date },
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
  for (const visit of live) facts.set(visit.id, factsOf(visit, landed, at));
  return facts;
}
