// Purchase orders' rules (docs/decisions/0166-purchase-orders.md): when one needs a second approver, and the states it
// moves through. No price is set here: every price is the supplier's, copied onto the order when it is drafted.

import { addDays, indiaDate } from "../lib/india-time.ts";

/**
 * A rupee order worth more than this needs a second approver until ops set their own amount in the console. Nought:
 * every order needs two, so nothing goes out on one person's word before ops decide otherwise.
 */
export const PO_SECOND_APPROVAL_ABOVE_RUPEES = 0;

export const PO_STATES = ["drafted", "approved", "sent", "part_received", "received", "closed", "cancelled"] as const;
export type PoState = (typeof PO_STATES)[number];

/**
 * Whether an order needs a second approver: one in rupees worth more than the amount ops set, and any in another
 * currency, whose worth in rupees is known only once it is received.
 */
export function needsSecondApproval(
  order: { readonly currency: string; readonly total: number },
  aboveRupees: number,
): boolean {
  return order.currency !== "INR" || order.total > aboveRupees * 100;
}

/** The states an order may be cancelled from: before anything of it arrived. */
export const CANCELLABLE: ReadonlySet<PoState> = new Set(["drafted", "approved", "sent"]);

/** One line of a receipt, as its landed cost is worked out: the supplier's price of one, and how many were accepted. */
interface CostedLine {
  readonly unitPrice: number;
  readonly received: number;
}

/**
 * What one unit of each line cost landed, in paise (docs/decisions/0167-receipts-and-landed-cost.md): the supplier's
 * price, in its currency's smallest unit, at `rupeeRate` paise to one unit of that currency, and the line's share of
 * `extras`, the receipt's freight, duty and clearing, by the value it brought. A line that brought nothing costs its
 * price alone; where no line brought value, the extras are shared by count.
 */
export function landedUnitCosts(lines: readonly CostedLine[], rupeeRate: number, extras: number): number[] {
  const unitPaise = lines.map((line) => (line.unitPrice * rupeeRate) / 100);
  const values = lines.map((line, index) => (unitPaise[index] ?? 0) * line.received);
  const totalValue = values.reduce((sum, value) => sum + value, 0);
  const totalCount = lines.reduce((sum, line) => sum + line.received, 0);
  return lines.map((line, index) => {
    const unit = unitPaise[index] ?? 0;
    if (line.received === 0) return Math.round(unit);
    const share = totalValue > 0 ? (extras * (values[index] ?? 0)) / totalValue : (extras * line.received) / totalCount;
    return Math.round(unit + share / line.received);
  });
}

/**
 * The last day, in India, of a supplier's warranty on what arrived in a receipt: the day it was received and the
 * supplier's warranty days after. A piece returned on or before it may be claimed.
 */
export function warrantyEndsOn(receivedAt: string, warrantyDays: number): string {
  return addDays(indiaDate(new Date(receivedAt)), warrantyDays);
}
