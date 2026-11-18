// Where a visit stands on its day, as Home's live card says it (./LiveCard.tsx), from what the API says of it.

import type { components } from "../api-schema.ts";

type VisitSummary = components["schemas"]["VisitSummary"];

export type LiveState =
  | "today"
  | "proposal"
  | "on_the_way"
  | "running_late"
  | "at_the_gate"
  | "arrived"
  | "in_progress"
  | "sign_off"
  | "done"
  | "closing"
  | "not_home"
  | "missed";

/**
 * Where the visit stands, from what the API says of it. Closed by the technician as anything but done, or past its
 * window after they arrived, it is being closed: missed where they marked the client not home. Past its window with
 * nobody arriving, it was missed.
 */
export function liveStateOf(visit: VisitSummary): LiveState {
  if (visit.stage === "done") return "done";
  if (visit.stage === "closing") return visit.not_home ? "not_home" : "closing";
  if (visit.stage === "missed") return "missed";
  if (visit.sign_off?.state === "asked" || visit.sign_off?.state === "flagged") return "sign_off";
  if (visit.stage === "in_progress") return "in_progress";
  if (visit.stage === "arrived") return "arrived";
  return visit.latest_update?.kind ?? (visit.proposed_move === null ? "today" : "proposal");
}

/** Where the five marks of the track stand: confirmed, on the way, arrived, the visit, done. Null: no track. */
export const TRACK_AT: Readonly<Record<LiveState, number | null>> = {
  today: 0,
  proposal: null,
  on_the_way: 1,
  running_late: 1,
  at_the_gate: 1,
  arrived: 2,
  in_progress: 3,
  sign_off: null,
  done: 4,
  closing: 3,
  not_home: null,
  missed: null,
};

/** The technician on their way or at the door: the card's mark pulses. */
export const MOVING: ReadonlySet<LiveState> = new Set(["on_the_way", "running_late", "at_the_gate", "arrived"]);

/** Nothing more will move on the card until the visit is closed. */
export const SETTLED: ReadonlySet<LiveState> = new Set(["done", "not_home", "missed"]);
