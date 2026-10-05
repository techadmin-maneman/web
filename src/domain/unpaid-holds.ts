// When an unpaid hold stops keeping its time, and which of a client's holds nothing can be paid on, as SQL fragments
// the queries about holds share.

import { PAYMENT_GRACE_SECONDS } from "../config/scheduling.ts";

/**
 * When an unpaid hold stops keeping its time: its countdown, then the grace it was made with, or the committed two
 * minutes for a hold made before holds kept one. `hold` names the slot_holds row in the query it goes into.
 */
export const graceEnds = (hold: string): string =>
  `strftime('%Y-%m-%dT%H:%M:%fZ', ${hold}.expires_at, '+' || COALESCE(${hold}.grace_seconds, ${String(PAYMENT_GRACE_SECONDS)}) || ' seconds')`;

/**
 * A client's own holds the app lets go when it holds them another: unconfirmed, with no Razorpay order and no payment
 * link, so nothing can be paid on them. `hold` names the slot_holds row, `person` the client's parameter.
 */
export const ownUnpaid = (hold: string, person: string): string =>
  `${hold}.person_id = ${person} AND ${hold}.confirmed_at IS NULL AND ${hold}.razorpay_order_id IS NULL AND ${hold}.pay_by_link = 0`;

/** graceEnds, for a hold already read: the last moment a payment for it counts as made in time. */
export function graceEndOf(hold: { readonly expires_at: string; readonly grace_seconds: number | null }): Date {
  const graceSeconds = hold.grace_seconds ?? PAYMENT_GRACE_SECONDS;
  return new Date(Date.parse(hold.expires_at) + graceSeconds * 1000);
}
