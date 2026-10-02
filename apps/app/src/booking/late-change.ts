// What changing a visit late costs the client, as the booking sheet says it: the days and windows already inside
// the notice, which are still sold and marked, and what the pay step promises about moving or cancelling later.

import type { Availability, Hold, MoveTerms, Price } from "../api.ts";

type Day = Availability["days"][number];

/** What a change inside the notice takes from the client. */
export type AtStake =
  | { readonly kind: "nothing" }
  | { readonly kind: "credit" }
  | { readonly kind: "late_fee"; readonly fee: Price }
  /** The visit's payment, GST included, which a late change keeps. */
  | { readonly kind: "payment"; readonly paid: number };

const NOTHING: AtStake = { kind: "nothing" };

/**
 * What changing the visit inside its notice would take, as it is sold: its late fee, the credit that pays for it, or
 * its payment. A visit moved in place keeps its own credit or payment, which `moving` says; the hold's price is only
 * what the move costs.
 */
export function atStake(hold: Hold, moving?: MoveTerms): AtStake {
  if (hold.late_change_charge === "nothing") return NOTHING;
  if (hold.late_change_charge === "late_fee") {
    return hold.late_fee === null ? NOTHING : { kind: "late_fee", fee: hold.late_fee };
  }
  const paidWithCredit = moving === undefined ? hold.credit !== null : moving.credit !== null;
  if (paidWithCredit) return { kind: "credit" };
  const paid = moving === undefined ? hold.price.amount : moving.paid;
  return paid === 0 ? NOTHING : { kind: "payment", paid };
}

/** Whether the visit is already inside the notice it is sold under at `now`, by the API's clock. */
export const insideNotice = (hold: Pick<Hold, "free_until">, now: number): boolean =>
  Date.parse(hold.free_until) <= now;

/** Whether a visit booked now in any of the day's open windows would already cost the client to change. */
export const dayInsideNotice = (day: Day): boolean =>
  day.windows.some((window) => window.with !== null && window.change_charged);
