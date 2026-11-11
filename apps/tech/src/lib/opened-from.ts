// Where a job's card was opened from, for its way back (docs/prompts/tech-redesign.md, "Information architecture":
// job → Today, or Schedule if opened from there). App notes each page shown; a card opened from Schedule goes back to
// the day it was opened on, and from anywhere else to Today. The screens within the job leave it as it was.

import { routeOf } from "../route.ts";

let last = "/";
const from = new Map<string, string>();
/** Where the guide open now was opened from: a later job's preview, or Guides. */
let guideFrom = "/guides";
/** Where Alerts was opened from: Me, or Today's bell. */
let alertsFrom = "/";

/** Notes the page shown; the same page again changes nothing. */
export function notePage(path: string): void {
  if (path === last) return;
  const route = routeOf(path);
  if (route.page === "job" && !last.startsWith(`/jobs/${route.id}`)) {
    from.set(route.id, last.startsWith("/week") ? last : "/");
  }
  if (route.page === "guide" && !last.startsWith(path)) guideFrom = last.startsWith("/week/") ? last : "/guides";
  if (route.page === "alerts") alertsFrom = last === "/me" ? "/me" : "/";
  last = path;
}

/** Where Alerts goes back to. */
export const alertsBack = (): string => alertsFrom;

/** Where the guide open now goes back to. */
export const guideBack = (): string => guideFrom;

/** Where the job's card goes back to. */
export const backOf = (id: string): string => from.get(id) ?? "/";
