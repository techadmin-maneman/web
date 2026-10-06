// The app's pages, by path. Links change the path without a reload; the Worker
// answers every path with the app, so a page can be opened directly.
//
//   /                        today's jobs, tomorrow collapsed
//   /waiting                 what has not reached us: the photo sets and the queued writes
//   /jobs/:id                one job's card, and the evidence chain
//   /jobs/:id/before-photos  step 1, the five before angles
//   /jobs/:id/checklist      step 2
//   /jobs/:id/consumables    step 3
//   /jobs/:id/piece          step 4, a replacement's and a first fit's only
//   /jobs/:id/profile        the client's hair profile, a consultation's and a one visit's only (no board; ADR 0106)
//   /jobs/:id/after-photos   step 5 (the camera again)
//   /jobs/:id/outcome        step 6
//   /jobs/:id/done           the close-out

import type { Step } from "./api.ts";

/** The router the apps share (packages/ui/router.tsx), so a screen takes its routes and its way between them from here. */
export { go, redirect, usePath } from "@maneman/ui/router";

/** The URL each step is at, and the step each URL means. The API's names, with hyphens. */
export const STEP_PATHS = {
  before_photos: "before-photos",
  checklist: "checklist",
  consumables: "consumables",
  piece: "piece",
  profile: "profile",
  after_photos: "after-photos",
  outcome: "outcome",
} as const satisfies Partial<Record<Step, string>>;

export type InJobStep = keyof typeof STEP_PATHS;

const STEP_OF = new Map<string, InJobStep>(
  Object.entries(STEP_PATHS).map(([step, segment]) => [segment, step as InJobStep]),
);

export type Route =
  | { readonly page: "today" }
  | { readonly page: "waiting" }
  | { readonly page: "job"; readonly id: string }
  | { readonly page: "step"; readonly id: string; readonly step: InJobStep }
  | { readonly page: "done"; readonly id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TODAY: Route = { page: "today" };

export function routeOf(path: string): Route {
  const [first, second, third, ...rest] = path.split("/").filter((part) => part !== "");
  if (first === undefined || rest.length > 0) return TODAY;
  if (second === undefined) return first === "waiting" ? { page: "waiting" } : TODAY;
  if (first !== "jobs" || !UUID.test(second)) return TODAY;
  if (third === undefined) return { page: "job", id: second };
  if (third === "done") return { page: "done", id: second };
  const step = STEP_OF.get(third);
  return step === undefined ? TODAY : { page: "step", id: second, step };
}

export const stepPath = (id: string, step: InJobStep) => `/jobs/${id}/${STEP_PATHS[step]}`;
