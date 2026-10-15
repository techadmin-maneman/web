// Purchase orders' rules (docs/decisions/0166-purchase-orders.md): when one needs a second approver, and the states it
// moves through. No price is set here: every price is the supplier's, copied onto the order when it is drafted.

import { MICRO_PER_RUPEE, paiseOf } from "../config/currencies.ts";
import { addDays, indiaDate } from "../lib/india-time.ts";

/**
 * A rupee order worth more than this needs a second approver until ops set their own amount in the console. Nought:
 * every order needs two, so nothing goes out on one person's word before ops decide otherwise.
 */
export const PO_SECOND_APPROVAL_ABOVE_RUPEES = 0;

/**
 * Rupees to one unit of a supplier's currency, as ops set them for approvals, by currency code. Nought, or no rate,
 * is a currency whose worth in rupees is not known before it is received: such an order always needs two approvers.
 */
export const PO_RUPEES_TO_ONE: Readonly<Record<string, number>> = { default: 0 };

export const PO_STATES = ["drafted", "approved", "sent", "part_received", "received", "closed", "cancelled"] as const;
export type PoState = (typeof PO_STATES)[number];

/**
 * Whether an order needs a second approver: one worth more in rupees than the amount ops set, an order in another
 * currency judged at the rate ops set for it, and one in a currency with no rate set always.
 */
export function needsSecondApproval(
  order: { readonly currency: string; readonly total: number },
  aboveRupees: number,
  rupeesToOne: Readonly<Record<string, number>> = PO_RUPEES_TO_ONE,
): boolean {
  if (order.currency === "INR") return order.total > aboveRupees * 100;
  const rate = rupeesToOne[order.currency] ?? rupeesToOne.default ?? 0;
  // The total is in the currency's smallest unit, whatever its decimal places.
  return rate <= 0 || paiseOf(order.total, order.currency, rate * MICRO_PER_RUPEE) > aboveRupees * 100;
}

/**
 * Days past its promised date before a custom order counts as late, and its client may have their money back in full,
 * until ops set their own in the console (docs/decisions/0176-custom-order-refunds.md).
 */
export const CUSTOM_ORDER_GRACE_DAYS = 7;

/** The states an order may be cancelled from: before anything of it arrived. */
export const CANCELLABLE: ReadonlySet<PoState> = new Set(["drafted", "approved", "sent"]);

/** One line of a receipt, as its landed cost is worked out: the supplier's price of one, and how many were accepted. */
interface CostedLine {
  readonly unitPrice: number;
  readonly received: number;
}

/**
 * What one unit of each line cost landed, in paise (docs/decisions/0167-receipts-and-landed-cost.md): the supplier's
 * price, in its currency's smallest unit, at `rate.micro` micro-rupees to one whole unit of `rate.currency`, and the
 * line's share of `extras`, the receipt's freight, duty and clearing, by the value it brought. A line that brought
 * nothing costs its price alone; where no line brought value, the extras are shared by count.
 */
export function landedUnitCosts(
  lines: readonly CostedLine[],
  rate: { readonly currency: string; readonly micro: number },
  extras: number,
): number[] {
  const unitPaise = lines.map((line) => paiseOf(line.unitPrice, rate.currency, rate.micro));
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
