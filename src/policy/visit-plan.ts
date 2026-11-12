// A visit's plan: the screens the technician works through, in order, for each kind of visit, and the steps the client
// is told of as the visit goes (docs/decisions/0244-the-visit-engine.md; docs/decisions/0255-client-alerts-and-push.md).
// The technician app's visit engine (apps/tech/src/visit/engine.ts) and the client's live visit both read it, so a
// step the technician is on is the step the client is told of.
//
// Each screen feeds one of the card's steps (src/policy/in-job-steps.ts), which the API sets for each visit and holds
// the phone to; a plan's screen whose step the card leaves out is not worked.

import type { VisitType } from "../config/visit-types.ts";
import type { CardStep } from "./in-job-steps.ts";

export const PLAN_SCREENS = [
  "before_photos",
  "tasks",
  "hair_profile",
  "hair_system",
  "consumables",
  "after_photos",
  "outcome",
] as const;
export type PlanScreen = (typeof PLAN_SCREENS)[number];

/** Which table a visit follows: its type, or the consultation and fit in one visit. */
export type VisitPlan = "service" | "replacement" | "first_fit" | "consultation" | "one_visit";

export const PLANS: Readonly<Record<VisitPlan, readonly PlanScreen[]>> = {
  service: ["before_photos", "tasks", "consumables", "after_photos", "outcome"],
  replacement: ["before_photos", "hair_system", "tasks", "consumables", "after_photos", "outcome"],
  first_fit: ["before_photos", "hair_profile", "hair_system", "tasks", "consumables", "after_photos", "outcome"],
  consultation: ["before_photos", "tasks", "hair_profile", "outcome"],
  one_visit: ["before_photos", "hair_profile", "hair_system", "tasks", "consumables", "after_photos", "outcome"],
};

/** The card's step each screen feeds. */
export const SCREEN_STEPS: Readonly<Record<PlanScreen, CardStep>> = {
  before_photos: "before_photos",
  tasks: "checklist",
  hair_profile: "profile",
  hair_system: "piece",
  consumables: "consumables",
  after_photos: "after_photos",
  outcome: "outcome",
};

export function planOf(visit: { readonly type: VisitType | null; readonly one_visit: boolean }): VisitPlan {
  if (visit.one_visit) return "one_visit";
  return visit.type ?? "service";
}

/**
 * The steps the client is told of: each a screen of the plan, named as the client knows it. The guided tasks are the
 * service, the fitting or the look at the scalp and hairline, by the plan; the count of what was used is part of the
 * work before it, and the outcome is the visit's close, so neither is a step of its own.
 */
export const CLIENT_STEPS = [
  "before_photos",
  "service",
  "scalp",
  "hair_profile",
  "hair_system",
  "fitting",
  "after_photos",
] as const;
export type ClientStep = (typeof CLIENT_STEPS)[number];

const TASKS_STEP: Readonly<Record<VisitPlan, ClientStep>> = {
  service: "service",
  consultation: "scalp",
  first_fit: "fitting",
  one_visit: "fitting",
  replacement: "fitting",
};

/** The step the client knows a screen as; none for the count of what was used and the outcome. */
function clientStepOf(screen: PlanScreen, plan: VisitPlan): ClientStep | null {
  if (screen === "consumables" || screen === "outcome") return null;
  return screen === "tasks" ? TASKS_STEP[plan] : screen;
}

/** The client's steps of a plan, each with the screen it is, among the card's steps `onCard`. */
export function clientStepsOf(
  plan: VisitPlan,
  onCard: ReadonlySet<string>,
): { readonly step: ClientStep; readonly screen: PlanScreen }[] {
  return PLANS[plan].flatMap((screen) => {
    const step = clientStepOf(screen, plan);
    return step === null || !onCard.has(SCREEN_STEPS[screen]) ? [] : [{ step, screen }];
  });
}

/**
 * The step the client is on: the one after the last whose card step has landed, or the first once the visit has
 * started; the last while it is the one still being worked. Its index counts from 1.
 */
export function currentStep(
  steps: readonly { readonly step: ClientStep; readonly screen: PlanScreen }[],
  landed: ReadonlySet<string>,
): { readonly index: number; readonly of: number; readonly name: ClientStep } | null {
  if (steps.length === 0) return null;
  const lastDone = steps.findLastIndex((each) => landed.has(SCREEN_STEPS[each.screen]));
  const at = Math.min(lastDone + 1, steps.length - 1);
  const current = steps[at];
  return current === undefined ? null : { index: at + 1, of: steps.length, name: current.step };
}
