import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import type { Task } from "../api.ts";
import { tasks } from "../content.ts";

type UntoldMove = Extract<Task["facts"], { group: "untold_move" }>;

/** A move the client has not heard of: the start it moved to, then why they were not told. */
export function untoldMoveOf({ starts_at: start, reason }: UntoldMove): string {
  const copy = tasks.subs.untold_move;
  const when = `${shortDate(indiaDate(start))}, ${indiaClock(start)}`;
  return reason === "no_consent" ? copy.no_consent(when) : copy.not_sent(when);
}
