// Where a visit stands on its day, as Home's live card says it (./LiveCard.tsx), from what the API says of it.

import type { components } from "../api-schema.ts";

type VisitSummary = components["schemas"]["VisitSummary"];

export type LiveState =
  "today" | "on_the_way" | "running_late" | "at_the_gate" | "arrived" | "in_progress" | "sign_off" | "done";

/** Where the visit stands, from what the API says of it. */
export function liveStateOf(visit: VisitSummary): LiveState {
  if (visit.stage === "done" || visit.stage === "closing") return "done";
  if (visit.sign_off?.state === "asked" || visit.sign_off?.state === "flagged") return "sign_off";
  if (visit.stage === "in_progress") return "in_progress";
  if (visit.stage === "arrived") return "arrived";
  return visit.latest_update?.kind ?? "today";
}

/** Where the five marks of the track stand: confirmed, on the way, arrived, the visit, done. */
export const TRACK_AT: Readonly<Record<LiveState, number>> = {
  today: 0,
  on_the_way: 1,
  running_late: 1,
  at_the_gate: 1,
  arrived: 2,
  in_progress: 3,
  sign_off: 3,
  done: 4,
};
