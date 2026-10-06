import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { tasks } from "../content.ts";

/** A move the client has not heard of, from its task's detail: the start it moved to, then why they were not told. */
export function untoldMoveOf(detail: string | null): string {
  const [start = "", reason] = detail?.split(" ") ?? [];
  if (start === "") return tasks.unknown;
  const copy = tasks.subs.untold_move;
  const when = `${shortDate(indiaDate(start))}, ${indiaClock(start)}`;
  if (reason === "no_consent") return copy.no_consent(when);
  if (reason === "not_sent") return copy.not_sent(when);
  return copy.unknown(when);
}
