// The dispatch board (docs/prompts/phase2-backend.md, "Technician and dispatch rules, from the designs").
// The rules as the prompt states them, the clash check they turn on, and the
// reasons a move must carry (docs/decisions/0034-clash-check.md).
//
// The board counts in slots and the day in half-slots, so a replacement's slot
// and a half is a whole number (docs/decisions/0035-window-slot-map.md). Where a
// visit fits inside a window is src/domain/scheduling.ts; the rule below is the
// one the prompt states, and both booking and dispatch answer to it.
//
// The last rule is quoted as the prompt writes it, and it is the one rule we do
// not keep: FSM has nowhere to read a leave period from, so ops record leave in
// the console and the same clash check reads it (ADR 0062).

import { VISIT_BLOCKS, type BookingWindow } from "../config/scheduling.ts";
import type { VisitType } from "../config/visit-types.ts";

export const RULES = [
  "Rows are technicians; columns are seven days; each day has config SLOTS_PER_DAY (4) slots.",
  "Blocks are sized in slots: consultation 1, service 1, replacement 1.5, first fit 2. Sizes come from the price book's visit types.",
  "A technician cannot hold two live jobs in one window on one date. This check runs on the server before any write to FSM.",
  "A move requires a reason from the design's list (technician unavailable, client asked to move it, zone rebalance, skill needed · first-fit certified, running over on an earlier job). It then updates FSM and messages the client with the new window.",
  "The client's payment carries over and he is never charged for a move ops make, including inside 24 hours.",
  "Leave periods come from FSM technician availability.",
] as const;

/** A block's size on the board, in slots: 1, 1, 1.5 and 2, from the half-slots the day is counted in. */
export const slotsFor = (type: VisitType): number => VISIT_BLOCKS[type].units / 2;

/**
 * What one technician already holds on one date: the windows his live jobs and
 * unexpired holds start in, and whether he is away. A visit being moved is left
 * out of its own day, as `occupancy` does with `exceptVisitId`.
 */
export interface TechnicianDay {
  readonly windows: ReadonlySet<BookingWindow>;
  readonly onLeave: boolean;
}

/** The clash: the technician already holds a live job in this window on this date. */
export const clashes = (day: TechnicianDay, window: BookingWindow): boolean => day.windows.has(window);

/** The reasons the design gives, in its own order. */
export const MOVE_REASONS = [
  "technician_unavailable",
  "client_asked",
  "zone_rebalance",
  "skill_needed",
  "running_over",
] as const;
export type MoveReason = (typeof MOVE_REASONS)[number];

export const isMoveReason = (reason: string): reason is MoveReason =>
  (MOVE_REASONS as readonly string[]).includes(reason);

/**
 * Why ops' move cannot be made; null when it can. The check runs on the server
 * before any write to FSM, so a refusal means nothing was written anywhere.
 *
 * `does_not_fit`: nobody holds the window, but the visit's block has no room
 * in it, because a half-slot it needs is taken or it would run past the day's
 * last one (docs/decisions/0035-window-slot-map.md). Whether it fits is
 * src/domain/scheduling.ts's answer, given here.
 */
export type MoveRefusal = "unknown_reason" | LandingRefusal;
export type LandingRefusal = "clash" | "on_leave" | "does_not_fit";

/**
 * Why a job cannot land in this window of this technician's day; null when it
 * can. Leave is answered before the clash, so ops are told the technician is
 * away rather than merely busy, and the clash before the room, so a held window
 * is named as held.
 */
export function landingRefusal(
  day: TechnicianDay,
  window: BookingWindow,
  room: { readonly fits: boolean },
): LandingRefusal | null {
  if (day.onLeave) return "on_leave";
  if (clashes(day, window)) return "clash";
  return room.fits ? null : "does_not_fit";
}

/** A move nobody can explain is refused before anything else is looked at. */
export function moveRefusal(
  day: TechnicianDay,
  window: BookingWindow,
  reason: string,
  room: { readonly fits: boolean } = { fits: true },
): MoveRefusal | null {
  if (!isMoveReason(reason)) return "unknown_reason";
  return landingRefusal(day, window, room);
}
