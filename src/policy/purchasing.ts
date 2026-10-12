// Purchase orders' rules (docs/decisions/0166-purchase-orders.md): when one needs a second approver, and the states it
// moves through. No price is set here: every price is the supplier's, copied onto the order when it is drafted.

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
