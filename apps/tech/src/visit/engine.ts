// The visit engine (docs/prompts/tech-redesign.md, "Visit engine"; docs/technician-redesign/PLAN.md, section 4;
// docs/decisions/0244-the-visit-engine.md): each visit type's screens, in order, as data, each feeding one of the
// API's events. The API says which events a visit takes (the card's steps) and refuses one sent early, so a screen
// shows only where its event is on the card. The hair profile is no ordered event, so it comes where the brief draws
// it, before the hair system.

import type { Job } from "../api.ts";
import { visit as copy } from "../content.ts";
import type { InJobStep } from "../route.ts";

export type ScreenId =
  "before_photos" | "tasks" | "hair_profile" | "hair_system" | "consumables" | "after_photos" | "outcome";

export interface Screen {
  readonly id: ScreenId;
  /** The API's event the screen feeds, queued when it is done. */
  readonly event: InJobStep;
  readonly title: string;
}

/** Which table a job follows: its type, or the consultation and fit in one visit. */
type Plan = "service" | "replacement" | "first_fit" | "consultation" | "one_visit";

const PLANS: Record<Plan, readonly ScreenId[]> = {
  service: ["before_photos", "tasks", "consumables", "after_photos", "outcome"],
  replacement: ["before_photos", "hair_system", "tasks", "consumables", "after_photos", "outcome"],
  first_fit: ["before_photos", "hair_profile", "hair_system", "tasks", "consumables", "after_photos", "outcome"],
  consultation: ["before_photos", "tasks", "hair_profile", "outcome"],
  one_visit: ["before_photos", "hair_profile", "hair_system", "tasks", "consumables", "after_photos", "outcome"],
};

const EVENTS: Record<ScreenId, InJobStep> = {
  before_photos: "before_photos",
  tasks: "checklist",
  hair_profile: "profile",
  hair_system: "piece",
  consumables: "consumables",
  after_photos: "after_photos",
  outcome: "outcome",
};

function planOf(job: Pick<Job, "type" | "one_visit">): Plan {
  if (job.one_visit) return "one_visit";
  return job.type ?? "service";
}

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

/** The screen that feeds an event. */
export function screenFor(job: Pick<Job, "type" | "one_visit" | "steps">, event: InJobStep): Screen | null {
  return screensOf(job).find((screen) => screen.event === event) ?? null;
}
