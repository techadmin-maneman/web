// The dispatch board (docs/prompts/phase2-backend.md, "Technician and dispatch rules, from the designs").
// The rules as the prompt states them, the clash check they turn on, and the
// reasons a move must carry (docs/decisions/0034-clash-check.md).
//
// The board counts in slots and the day in half-slots, so a replacement's slot
// and a half is a whole number (docs/decisions/0035-window-slot-map.md). Where a
// visit fits inside a window is src/domain/scheduling.ts; the rule below is the
// one the prompt states, and both booking and dispatch answer to it. A block's
// size now comes from its service's length rather than its kind's alone, by the
// one rule in src/policy/visit-length.ts, which gives the prompt's four sizes for
// the four kinds' own lengths (docs/decisions/0085-services-ops-can-edit.md).
//
// The last rule is quoted as the prompt writes it, and it is the one rule we do
// not keep: FSM has nowhere to read a leave period from, so ops record leave in
// the console and the same clash check reads it (ADR 0062).

import type { BookingWindow } from "../config/scheduling.ts";

export const RULES = [
  "Rows are technicians; columns are seven days; each day has config SLOTS_PER_DAY (4) slots.",
  "Blocks are sized in slots: consultation 1, service 1, replacement 1.5, first fit 2. Sizes come from the price book's visit types.",
  "A technician cannot hold two live jobs in one window on one date. This check runs on the server before any write to FSM.",
  "A move requires a reason from the design's list (technician unavailable, client asked to move it, zone rebalance, skill needed · first-fit certified, running over on an earlier job). It then updates FSM and messages the client with the new window.",
  "The client's payment carries over and he is never charged for a move ops make, including inside 24 hours.",
  "Leave periods come from FSM technician availability.",
] as const;

/** A block's size on the board, in slots, from the half-slots it holds: 1, 1, 1.5 and 2 for the kinds' own lengths. */
export const slotsFor = (units: number): number => units / 2;

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

/**
 * Whether a move ops make leaves the client counting their notice from the visit's time before it
 * (src/policy/moving-a-visit.ts): every move but one the client asked for, whose new time the client chose, as a
 * move in the app is theirs (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
 */
export const keepsTheClientsNotice = (reason: MoveReason): boolean => reason !== "client_asked";

/**
 * How far the technician has got on a visit, by the steps his phone has sent, which FSM's status can lag behind: he
 * has arrived, started, or closed it (a no-show closes it too).
 */
export const BEGUN = ["arrived", "started", "closed"] as const;
export type Begun = (typeof BEGUN)[number];

/** The furthest of those steps the visit has; null before the technician arrives. */
export function begunFrom(landed: {
  readonly checkIn: boolean;
  readonly start: boolean;
  readonly outcome: boolean;
}): Begun | null {
  if (landed.outcome) return "closed";
  if (landed.start) return "started";
  if (landed.checkIn) return "arrived";
  return null;
}

/**
 * Why a job cannot go to this window of this technician's day; null when it
 * can. The check runs on the server before any write to FSM, so a refusal
 * means nothing was written anywhere. (A move's reason is one of the list
 * above before it gets here: the API and the table accept no other.)
 *
 * Leave is answered first, so ops are told the technician is away rather than
 * merely busy, and the clash before the room, so a held window is named as
 * held. `does_not_fit`: nobody holds the window, but the visit's block has no
 * room in it, because a half-slot it needs is taken or it would run past the
 * day's last one (docs/decisions/0035-window-slot-map.md). Whether it fits is
 * src/domain/scheduling.ts's answer, given here.
 */
export type MoveRefusal = "clash" | "on_leave" | "does_not_fit";

export function moveRefusal(
  day: TechnicianDay,
  window: BookingWindow,
  room: { readonly fits: boolean },
): MoveRefusal | null {
  if (day.onLeave) return "on_leave";
  if (clashes(day, window)) return "clash";
  return room.fits ? null : "does_not_fit";
}

/**
 * How the client hears of a move ops made. The rule above ends "messages the
 * client with the new window"; a WhatsApp message about a visit goes only to a
 * client who agreed to them (the whatsapp_visits consent), so any other is
 * called by ops, and the call waits on the Tasks board until ops say it was
 * made (docs/decisions/0069-dispatch-under-concurrency.md).
 *
 *   messaged    the new window was queued to go on WhatsApp
 *   call        the client has not agreed to WhatsApp about his visits: ops call him
 *   unchanged   only the technician changed: the client's day and window are as they were
 *   no_client   the visit has no client on our records to tell
 */
export const CLIENT_NOTICES = ["messaged", "call", "unchanged", "no_client"] as const;
export type ClientNotice = (typeof CLIENT_NOTICES)[number];

export function clientNotice(move: {
  readonly timeChanged: boolean;
  readonly client: { readonly agreedToWhatsApp: boolean } | null;
}): ClientNotice {
  if (!move.timeChanged) return "unchanged";
  if (move.client === null) return "no_client";
  return move.client.agreedToWhatsApp ? "messaged" : "call";
}
