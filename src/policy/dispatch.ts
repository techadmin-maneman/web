// The dispatch board: how big a block is drawn, and the reasons a move must carry. Where a move lands, and why one is
// refused, is the technician's day plan (docs/decisions/0210-booking-by-start-time.md;
// src/domain/dispatch/dispatch-landing.ts), which booking runs too, so the two cannot disagree.
//
// The board draws in slots, so a replacement's slot and a half is a whole number (docs/decisions/0035-window-slot-map.md).
// A block's size comes from its service's length rather than its kind's alone, by the one rule in
// src/policy/visit-length.ts, which gives the board's four sizes for the four kinds' own lengths
// (docs/decisions/0085-services-ops-can-edit.md).

/**
 * How long a move to another day waits for the client's answer, or until the visit's own start if that is sooner
 * (docs/decisions/0115-a-move-to-another-day-waits-for-the-client.md). Ops set it in Settings.
 */
export const MOVE_PROPOSAL_HOURS = 48;

/** A block's size on the board, in slots, from the half-slots it holds: 1, 1, 1.5 and 2 for the kinds' own lengths. */
export const slotsFor = (units: number): number => units / 2;

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
 * Whether a move ops make must be asked of the client rather than made
 *: one to another day that the client did not
 * ask for. Within the visit's own day the board moves at once.
 */
export const asksTheClient = (move: { reason: MoveReason; sameDay: boolean }): boolean =>
  !move.sameDay && move.reason !== "client_asked";

/**
 * How far the technician has got on a visit, by the steps their phone has sent: they have arrived, started, or closed it (a no-show closes it too).
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
 * Whether a move's start is still ahead: `past_day` for a day gone, `window_passed` for a start on today already
 * passed, or today's window once each of its starts has, `ahead` otherwise.
 */
export type TargetTime = "past_day" | "window_passed" | "ahead";

/**
 * Why a job cannot go to a technician's day where a move puts it (src/domain/dispatch/dispatch-landing.ts). The check
 * runs on the server before anything is written, so a refusal means nothing was written anywhere.
 *
 * A time already gone is answered first; then leave or a day off, so ops are told the technician is away rather than
 * busy; then `back_to_back`, a technician who took the client's visit just before or just after this one, who never
 * takes two in a row (docs/decisions/0111-a-technician-never-takes-two-visits-in-a-row.md); then the clash, a visit
 * already at that time, so a taken time is named as taken; then `does_not_fit`, a day with no room for the visit
 * there, with its drives and wrap-up, by its day plan. A blacked-out day comes last, since ops may still move a visit
 * onto one with a reason. A hold or another move that took the time after it was checked is a clash too.
 */
export type MoveRefusal =
  | Exclude<TargetTime, "ahead">
  | "on_leave"
  | "back_to_back"
  | "clash"
  | "does_not_fit"
  | "blackout"
  /** Handed to a technician who works in another city than the visit's, or in none yet (ADR 0117). */
  | "other_city"
  /** A first fit handed to a technician not trained to fit (ADR 0119). */
  | "not_trained";

/**
 * How the client hears of a move ops made. The rule above ends "messages the
 * client with the new window"; a WhatsApp message about a visit goes only to a
 * client who agreed to them (the whatsapp_visits consent), so any other is
 * called by ops, and the call waits on the Tasks board until ops say it was
 * made (docs/decisions/0069-dispatch-under-concurrency.md).
 *
 *   messaged    the new window was queued to go on WhatsApp
 *   call        the client has not agreed to WhatsApp about their visits: ops call them
 *   unchanged   only the technician changed: the client's day and window are as they were
 */
export const CLIENT_NOTICES = ["messaged", "call", "unchanged"] as const;
export type ClientNotice = (typeof CLIENT_NOTICES)[number];

/**
 * Why a client has not heard of a move, so the call ops make starts from the right place:
 *
 *   no_consent   they have not agreed to WhatsApp about their visits, or took it back before the message went
 *   not_sent     they had agreed, but the WhatsApp was skipped or failed
 */
export const UNTOLD_REASONS = ["no_consent", "not_sent"] as const;
export type UntoldReason = (typeof UNTOLD_REASONS)[number];

export function clientNotice(move: {
  readonly timeChanged: boolean;
  readonly client: { readonly agreedToWhatsApp: boolean };
}): ClientNotice {
  if (!move.timeChanged) return "unchanged";
  return move.client.agreedToWhatsApp ? "messaged" : "call";
}
