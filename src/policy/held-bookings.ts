// A booking FSM refuses is held, not refunded (docs/decisions/0095-a-booking-fsm-refuses-is-held.md). The owner
// ruled on 27 September 2026 (docs/open-points.md, item 141): once FSM has refused a booking five times running,
// its slot and its payment are kept and ops are told once; it is tried again every hour for 24 hours from the fifth
// refusal, and then waits for ops, who book it in FSM or refund it from the console. How often and for how long are
// ops' to set in the console (docs/decisions/0088-every-policy-in-the-console.md); the owner's figures stand until
// they do.

import { HOUR_MS } from "../lib/durations.ts";

export const RULES = [
  "hold it and alert ops.",
  "after the fifth refusal the slot and the payment are kept and ops are alerted once; the queue keeps trying hourly for 24 hours, and ops book it in FSM or refund it from the console.",
] as const;

/** The refusals running after which a booking is held for FSM: the queue's fifth try is its last. */
export const REFUSALS_BEFORE_HELD = 5;

/** How often a held booking is tried again, in hours. */
export const RETRY_EVERY_HOURS = 1;

/** How long after the fifth refusal a held booking is still tried again, in hours. */
export const RETRY_FOR_HOURS = 24;

export const FSM_RETRY_KEYS = ["every", "for"] as const;
/** The two figures as ops set them, both in hours. */
export type FsmRetry = Readonly<Record<(typeof FSM_RETRY_KEYS)[number], number>>;

export const FSM_RETRY: FsmRetry = { every: RETRY_EVERY_HOURS, for: RETRY_FOR_HOURS };

/** When a booking held at `heldAt` is no longer tried again, and waits for ops alone. */
export const retriesEnd = (heldAt: Date, retry: FsmRetry = FSM_RETRY): Date =>
  new Date(heldAt.getTime() + retry.for * HOUR_MS);

/**
 * Whether a held booking is due another try now: its retries have not ended, its visit has not begun, and its last
 * try was at least an interval ago.
 */
export function dueAnotherTry(
  booking: { readonly heldAt: Date; readonly lastTried: Date; readonly visitStart: Date },
  now: Date,
  retry: FsmRetry = FSM_RETRY,
): boolean {
  if (now >= retriesEnd(booking.heldAt, retry)) return false;
  if (now >= booking.visitStart) return false;
  return now.getTime() - booking.lastTried.getTime() >= retry.every * HOUR_MS;
}
