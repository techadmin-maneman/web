// The visit engine (docs/prompts/tech-redesign.md, "Visit engine"; docs/technician-redesign/PLAN.md, section 4;
// docs/decisions/0244-the-visit-engine.md): each visit type's screens, in order, as data, each feeding one of the
// API's events. The API says which events a visit takes (the card's steps) and refuses one sent early, so a screen
// shows only where its event is on the card. The hair profile is no ordered event, so it comes where the brief draws
// it, before the hair system.

import type { Job } from "../api.ts";
import { visit as copy } from "../content.ts";
import type { InJobStep } from "../route.ts";
import { PLANS, planOf, SCREEN_STEPS, type PlanScreen, type VisitPlan } from "@rules/policy/visit-plan.ts";

type ScreenId = PlanScreen;

export interface Screen {
  readonly id: ScreenId;
  /** The API's event the screen feeds, queued when it is done. */
  readonly event: InJobStep;
  readonly title: string;
}

/** Which table a job follows (src/policy/visit-plan.ts, which the client's live visit reads too). */
type Plan = VisitPlan;

/** The API's event each screen feeds: the card's step, which is an event for every screen the engine works. */
const EVENTS = SCREEN_STEPS as Readonly<Record<ScreenId, InJobStep>>;

/** The guided tasks' title: a service's, a fitting's, or a consultation's look at the scalp and hairline. */
function tasksTitle(plan: Plan): string {
  if (plan === "service") return copy.screens.service;
  if (plan === "consultation") return copy.screens.scalp;
  return copy.screens.fitting;
}

function titleOf(id: ScreenId, plan: Plan): string {
  return id === "tasks" ? tasksTitle(plan) : copy.screens[id];
}

/** The job's screens, in the order they are worked, each only where the card says its event applies. */
export function screensOf(job: Pick<Job, "type" | "one_visit" | "steps">): Screen[] {
  const plan = planOf(job);
  const onCard = new Set<string>(job.steps);
  return PLANS[plan]
    .filter((id) => onCard.has(EVENTS[id]))
    .map((id) => ({ id, event: EVENTS[id], title: titleOf(id, plan) }));
}
