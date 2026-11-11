// Where a job's card was opened from, for its way back (docs/prompts/tech-redesign.md, "Information architecture":
// job → Today, or Schedule if opened from there). App notes each page shown; a card opened from Schedule goes back to
// the day it was opened on, and from anywhere else to Today. The screens within the job leave it as it was.

import { routeOf } from "../route.ts";

let last = "/";
const from = new Map<string, string>();

/** Notes the page shown; the same page again changes nothing. */
export function notePage(path: string): void {
  if (path === last) return;
  const route = routeOf(path);
  if (route.page === "job" && !last.startsWith(`/jobs/${route.id}`)) {
    from.set(route.id, last.startsWith("/week") ? last : "/");
  }
  last = path;
}

/** Where the job's card goes back to. */
export const backOf = (id: string): string => from.get(id) ?? "/";
