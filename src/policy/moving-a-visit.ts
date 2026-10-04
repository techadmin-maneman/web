// A client moving or cancelling a visit, and ops moving one (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rules as the prompt states them, the owner's ruling on a move by ops, and what each costs
// (docs/decisions/0046-moving-and-cancelling.md, docs/decisions/0096-a-no-shows-charge-and-its-dispute.md). The
// terms are worked out in src/domain/visit-changes.ts, and a move is booked in src/domain/bookings.ts.

import type { VisitType } from "../config/visit-types.ts";
import { HOUR_MS } from "../lib/durations.ts";

export const RULES = [
  "More than 24 hours before the window starts: moving or cancelling is free. The payment carries over, or is refunded to its source; a credit comes back.",
  "Inside 24 hours:",
  "a paid service visit is charged, and the new visit is paid separately",
  "a credit booking loses the credit",
  "a first fit costs a late fee of config LATE_FEE_FIRST_FIT (Rs. 4,000 in the design), with the balance carried over",
  "a replacement's late fee is config LATE_FEE_REPLACEMENT (Rs. 3,000 in the design)",
  "When ops move a visit, the client is never charged.",
  // The owner, 27 September 2026 (docs/owner-answers-2026-09-27.md, item 71).
  "after a move by ops, the client's notice counts from the visit's time before ops moved it.",
  // The owner, 2 October 2026 (the audit's decision 5).
  "When ops cancel a visit, the client is never charged, unless ops apply the client's late terms, with a reason.",
] as const;

/** Moving or cancelling is free until this long before the window starts. */
export const FREE_CHANGE_NOTICE_HOURS = 24;

export type Notice = "free" | "late";

/** Until when changing a visit is free: the notice before its window, 24 hours unless ops set another. */
export const freeUntil = (windowStarts: Date, noticeHours: number = FREE_CHANGE_NOTICE_HOURS): Date =>
  new Date(windowStarts.getTime() - noticeHours * HOUR_MS);

export const noticeAt = (windowStarts: Date, now: Date, noticeHours: number = FREE_CHANGE_NOTICE_HOURS): Notice =>
  now.getTime() < freeUntil(windowStarts, noticeHours).getTime() ? "free" : "late";

/**
 * The time a client's own move or cancel counts its notice from (RULES[7]): the visit's time before ops moved it,
 * so the client keeps the free change they had, unless the visit now starts later, which gives them more
 * (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
 */
export const noticeCountsFrom = (start: Date, startBeforeMove: Date | null): Date =>
  startBeforeMove !== null && startBeforeMove.getTime() > start.getTime() ? startBeforeMove : start;

/**
 * The notice an ops cancel is charged as (RULES[8]): free, unless ops apply the client's own terms, as when the client
 * phones to cancel inside the notice.
 */
export const opsCancelCharged = (notice: Notice, onClientTerms: boolean): Notice => (onClientTerms ? notice : "free");

/** The late fee a first fit or a replacement costs inside 24 hours. */
export const LATE_FEES: Partial<Record<VisitType, "late_fee_first_fit" | "late_fee_replacement">> = {
  first_fit: "late_fee_first_fit",
  replacement: "late_fee_replacement",
};

/**
 * What a kind of visit costs when the client changes it inside the notice, as ops set it
 * (docs/decisions/0088-every-policy-in-the-console.md):
 *   nothing   it is free, as it is ahead of the notice;
 *   late_fee  its kind's late fee, a price of its own in the price book;
 *   visit     the visit itself: its payment is kept, or its credit spent.
 */
export type Charge = "nothing" | "late_fee" | "visit";

export const CHARGES = ["nothing", "late_fee", "visit"] as const satisfies readonly Charge[];

/** What each kind of visit costs inside the notice. */
export type Charges = Readonly<Record<VisitType, Charge>>;

/** The rules above, as each kind's charge: until ops set others, the committed terms. */
export const LATE_CHANGE_CHARGES: Charges = {
  consultation: "nothing",
  first_fit: "late_fee",
  replacement: "late_fee",
  service: "visit",
};

/** The charges a kind of visit may be given: a late fee only where the price book has one for the kind. */
export const chargesFor = (type: VisitType): readonly Charge[] =>
  LATE_FEES[type] === undefined ? ["nothing", "visit"] : CHARGES;

/**
 * The terms a booking is sold under, kept on its hold as it is made (docs/decisions/0088-every-policy-in-the-console.md):
 * the notice, what its kind costs inside it, and what it costs if the client is not home (src/policy/no-show.ts).
 */
export interface SoldTerms {
  readonly noticeHours: number;
  readonly lateCharge: Charge;
  readonly noShowCharge: Charge;
}

/**
 * Whether a visit sold under `terms` and booked now, at `now`, would already cost the client to move or cancel: it
 * starts inside its notice, and its kind is charged there. The date picker marks such a window.
 */
export const changeChargedOnBooking = (
  windowStarts: Date,
  now: Date,
  terms: Pick<SoldTerms, "noticeHours" | "lateCharge">,
): boolean => terms.lateCharge !== "nothing" && noticeAt(windowStarts, now, terms.noticeHours) === "late";

/**
 * What a move costs the client:
 *   free      the visit moves, and its payment carries over;
 *   late_fee  the late fee is paid now, then the visit moves with its payment;
 *   charged   the visit's payment is kept, and the new visit is booked and paid separately.
 */
export type MoveCost = "free" | "late_fee" | "charged";

const MOVE_COSTS: Readonly<Record<Charge, MoveCost>> = { nothing: "free", late_fee: "late_fee", visit: "charged" };

export function moveCost(
  type: VisitType,
  notice: Notice,
  by: "client" | "ops",
  charge: Charge = LATE_CHANGE_CHARGES[type],
): MoveCost {
  if (by === "ops" || notice === "free") return "free";
  return MOVE_COSTS[charge];
}

/**
 * What becomes of the credit a visit was paid with, when the client moves or cancels it:
 *   restored  it comes back, more than 24 hours ahead, or inside them where ops charge the visit nothing;
 *   lost      it is spent, inside 24 hours.
 * A credit pays for a service visit (src/policy/referral-reward.ts), so its charge is a service visit's.
 */
export type CreditOnChange = "restored" | "lost";

export const creditOnChange = (notice: Notice, charge: Charge = LATE_CHANGE_CHARGES.service): CreditOnChange =>
  notice === "free" || charge === "nothing" ? "restored" : "lost";

/**
 * What cancelling gives back:
 *   all           the whole payment, to its source;
 *   all_but_fee   the payment less the late fee (docs/open-points.md, item 7);
 *   none          the payment is kept.
 */
export type CancelRefund = "all" | "all_but_fee" | "none";

const CANCEL_REFUNDS: Readonly<Record<Charge, CancelRefund>> = {
  nothing: "all",
  late_fee: "all_but_fee",
  visit: "none",
};

export function cancelRefund(
  type: VisitType,
  notice: Notice,
  charge: Charge = LATE_CHANGE_CHARGES[type],
): CancelRefund {
  if (notice === "free") return "all";
  return CANCEL_REFUNDS[charge];
}
