// What the board says over itself once a move is sent (./DispatchScreen.tsx): what the move did, from the server's
// own answer, or why it was refused, naming the technician and the window the board asked for, since the API answers
// with the code alone.

import { shortDate } from "@maneman/web-kit/dates";
import type { Board, Moved } from "../api.ts";
import { dispatch } from "../content.ts";
import { phoneWords } from "../lib/phone.ts";
import { idOf, nameOf, personOf, shownOf, typeOf, windowWord, type Job, type Target } from "./job.ts";

/** A line over the board: what a move did, or why it was refused. A call still to make carries its move. */
export interface Notice {
  readonly tone: "done" | "refusal";
  readonly text: string;
  readonly call: { readonly moveId: string; readonly name: string } | null;
}

/**
 * What a move did, in words, from the server's own answer. A message queued is not yet one sent, so the notice says
 * it is on its way, and where it fails the move waits on the Tasks board for a call.
 */
export function doneNotice(job: Job, to: Target, moved: Moved): Notice {
  const copy = dispatch.landing.moved;
  const name = nameOf(job);
  const person = personOf(job);
  if (moved.client_notice === "messaged") return { tone: "done", text: copy.messaged(name), call: null };
  if (moved.client_notice === "unchanged") {
    return { tone: "done", text: copy.unchanged(name, to.technician.name), call: null };
  }
  if (moved.client_notice === "call" && person !== null) {
    return {
      tone: "done",
      text: copy.call(name, person.name, phoneWords(person.mobile)),
      call: { moveId: moved.move_id, name: person.name },
    };
  }
  return { tone: "done", text: copy.noClient(name), call: null };
}

/** Why a move was refused, in the board's words. Nothing was written either way. */
export function refusalOf(job: Job, to: Target, code: string): string {
  const copy = dispatch.landing;
  if (code === "past_day") return copy.pastDay(shortDate(to.date));
  if (code === "window_passed") return copy.windowPassed(shortDate(to.date), windowWord(to.window));
  if (code === "blackout") return copy.blackout(shortDate(to.date));
  if (code === "clash") return copy.clash(to.technician.name, shortDate(to.date), windowWord(to.window));
  if (code === "on_leave") return copy.onLeave(to.technician.name, shortDate(to.date));
  if (code === "does_not_fit") {
    const type = typeOf(job);
    const typeName = type === null ? nameOf(job) : (dispatch.typeNames[type] ?? type);
    return copy.doesNotFit(typeName, to.technician.name, shortDate(to.date), windowWord(to.window));
  }
  const errors: Readonly<Record<string, string | undefined>> = copy.errors;
  return errors[code] ?? copy.errors.unknown;
}

/** Where a job is on a board, and whether it is where the board it was taken from had it. */
function placeOn(board: Board, job: Job): { readonly words: string; readonly unchanged: boolean } | null {
  const shown = shownOf(job);
  for (const row of board.technicians) {
    for (const day of row.days) {
      const block = day.blocks.find((each) => each.appointment_id === idOf(job));
      if (block === undefined) continue;
      return {
        words: dispatch.landing.supersededWhere(row.name, shortDate(day.date), windowWord(block.window)),
        unchanged: row.technician_id === shown.technicianId && block.starts_at === shown.startsAt,
      };
    }
  }
  return null;
}

/** Refusals that mean the job is no longer as the board had it: it is let go, and the board read again. */
export const STALE = new Set(["superseded", "not_found", "in_progress"]);

/**
 * What a move refused as stale says, from the board read again: another move of the same job still being written
 * leaves it where it was; a move already made has put it somewhere else.
 */
export function staleWords(job: Job, code: string, now: Board | null): string {
  const copy = dispatch.landing;
  if (code === "not_found") return copy.errors.not_found;
  if (code === "in_progress") return copy.errors.in_progress;
  const place = now === null ? null : placeOn(now, job);
  if (place?.unchanged === true) return copy.beingMoved(nameOf(job));
  return copy.superseded(nameOf(job), place?.words ?? copy.supersededGone);
}
