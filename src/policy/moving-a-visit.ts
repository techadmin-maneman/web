// A client moving or cancelling a visit, and ops moving one (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rules as the prompt states them, and what each costs (docs/decisions/0046-moving-and-cancelling.md).
// A credit booking's rule arrives with the credits (P2-M3).

import type { VisitType } from "../config/visit-types.ts";

export const RULES = [
  "More than 24 hours before the window starts: moving or cancelling is free. The payment carries over, or is refunded to its source; a credit comes back.",
  "Inside 24 hours:",
  "a paid service visit is charged, and the new visit is paid separately",
  "a credit booking loses the credit",
  "a first fit costs a late fee of config LATE_FEE_FIRST_FIT (Rs. 4,000 in the design), with the balance carried over",
  "a replacement's late fee is config LATE_FEE_REPLACEMENT (Rs. 3,000 in the design)",
  "When ops move a visit, the client is never charged.",
] as const;

/** Moving or cancelling is free until this long before the window starts. */
export const FREE_CHANGE_NOTICE_HOURS = 24;

export type Notice = "free" | "late";

/** Until when changing a visit is free. */
export const freeUntil = (windowStarts: Date): Date =>
  new Date(windowStarts.getTime() - FREE_CHANGE_NOTICE_HOURS * 3_600_000);

export const noticeAt = (windowStarts: Date, now: Date): Notice =>
  now.getTime() < freeUntil(windowStarts).getTime() ? "free" : "late";

/** The late fee a first fit or a replacement costs inside 24 hours. */
export const LATE_FEES: Partial<Record<VisitType, "late_fee_first_fit" | "late_fee_replacement">> = {
  first_fit: "late_fee_first_fit",
  replacement: "late_fee_replacement",
};

/**
 * What a move costs the client:
 *   free      the visit moves, and its payment carries over;
 *   late_fee  the late fee is paid now, then the visit moves with its payment;
 *   charged   the visit's payment is kept, and the new visit is booked and paid separately.
 */
export type MoveCost = "free" | "late_fee" | "charged";

export function moveCost(type: VisitType, notice: Notice, by: "client" | "ops"): MoveCost {
  if (by === "ops" || notice === "free") return "free";
  if (LATE_FEES[type] !== undefined) return "late_fee";
  return type === "service" ? "charged" : "free";
}

/**
 * What cancelling gives back:
 *   all           the whole payment, to its source;
 *   all_but_fee   the payment less the late fee (docs/open-points.md, item 7);
 *   none          the payment is kept.
 */
export type CancelRefund = "all" | "all_but_fee" | "none";

export function cancelRefund(type: VisitType, notice: Notice): CancelRefund {
  if (notice === "free") return "all";
  if (LATE_FEES[type] !== undefined) return "all_but_fee";
  return type === "service" ? "none" : "all";
}
