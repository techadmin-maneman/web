// The app's pages, by path. Links change the path without a reload; the Worker
// answers every path with the app, so a page can be opened directly.
//
//   /                        today's jobs, tomorrow collapsed (board A1)
//   /waiting                 what has not reached us: the photo sets and the queued writes (board A2)
//   /jobs/:id                one job's card, and the evidence chain (boards A3 and B5)
//   /jobs/:id/before-photos  step 1, the five before angles (board B1)
//   /jobs/:id/checklist      step 2 (board B2)
//   /jobs/:id/consumables    step 3 (board B3)
//   /jobs/:id/piece          step 4, a replacement's and a first fit's only (board B3)
//   /jobs/:id/after-photos   step 5 (board B1 again)
//   /jobs/:id/outcome        step 6 (board B4)
//   /jobs/:id/done           the close-out (board B4)

import { useEffect, useState } from "react";
import type { Step } from "./api.ts";

/** The URL each step is at, and the step each URL means. The API's names, with hyphens. */
export const STEP_PATHS = {
  before_photos: "before-photos",
  checklist: "checklist",
  consumables: "consumables",
  piece: "piece",
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

/** The path shown, which keys the page so each one opens at its top. */
export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onChange = () => {
      setPath(window.location.pathname);
    };
    window.addEventListener("popstate", onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
    };
  }, []);
  return path;
}

export function go(path: string): void {
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
