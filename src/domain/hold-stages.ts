// A hold's stages, as SQL fragments the queries about holds share (docs/architecture.md, "A hold's stages"). `hold`
// names the slot_holds row in the query a fragment goes into.

import { PAYMENT_GRACE_SECONDS } from "../config/scheduling.ts";

/** A hold's state column: held while it keeps its time, booked once it is a visit, released once let go. */
export type HoldState = "held" | "booked" | "released";

/**
 * When an unpaid hold stops keeping its time: its countdown, then the grace it was made with, or the committed two
 * minutes for a hold made before holds kept one.
 */
export const graceEnds = (hold: string): string =>
  `strftime('%Y-%m-%dT%H:%M:%fZ', ${hold}.expires_at, '+' || COALESCE(${hold}.grace_seconds, ${String(PAYMENT_GRACE_SECONDS)}) || ' seconds')`;

/** graceEnds, for a hold already read: the last moment a payment for it counts as made in time. */
export function graceEndOf(hold: { readonly expires_at: string; readonly grace_seconds: number | null }): Date {
  const graceSeconds = hold.grace_seconds ?? PAYMENT_GRACE_SECONDS;
  return new Date(Date.parse(hold.expires_at) + graceSeconds * 1000);
}

/** Keeping its time at `now`: paid for, or inside its countdown and grace. */
export const keepingItsTime = (hold: string, now: string): string =>
  `${hold}.state = 'held' AND (${hold}.confirmed_at IS NOT NULL OR ${graceEnds(hold)} > ${now})`;

/** Paid for, or taken free or on a credit, and not yet a visit: its request, or the half-hour pass, books it. */
export const paidNotBooked = (hold: string): string => `${hold}.state = 'held' AND ${hold}.confirmed_at IS NOT NULL`;

/**
 * A client's own holds the app lets go when it holds them another: unconfirmed, with no Razorpay order and no payment
 * link, so nothing can be paid on them. `person` is the client's parameter.
 */
export const ownUnpaid = (hold: string, person: string): string =>
  `${hold}.person_id = ${person} AND ${hold}.confirmed_at IS NULL AND ${hold}.razorpay_order_id IS NULL AND ${hold}.pay_by_link = 0`;
