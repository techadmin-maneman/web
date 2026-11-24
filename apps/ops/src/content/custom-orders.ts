// A client's custom orders, on their Pieces tab (docs/decisions/0174-custom-orders.md). Only that panel reads it,
// loaded when the tab opens.

import { changed, FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

export const customOrders = {
  title: "Custom orders",
  none: "None yet.",
  columns: ["Order", "Made to", "Price", "Status"],
  /** The actions' column, read aloud. */
  actions: "Change",
  /** "CU-0007" */
  number: (number: number) => `CU-${String(number).padStart(4, "0")}`,
  /** "8x10 1B, 20% grey, 100%, slight wave" */
  spec: (order: {
    base_width_in: number;
    base_length_in: number;
    colour: string;
    grey_percent: number;
    density_percent: number;
    wave: string | null;
  }) =>
    `${String(order.base_width_in)}×${String(order.base_length_in)} in, ${order.colour}, ${String(order.grey_percent)}% grey, ${String(order.density_percent)}% density` +
    (order.wave === null ? "" : `, ${order.wave.replace("_", " ")}`),
  statuses: {
    awaiting_payment: "Awaiting payment",
    paid: "Paid, being ordered",
    ordered: "Ordered",
    arrived: "Arrived",
    refunded: "Refunded in full",
    cancelled: "Cancelled",
  },
  link: "Payment link",
  /** "PO-0042": its purchase order, linked to Purchasing, while it is being ordered. */
  purchaseOrder: (number: number) => `PO-${String(number).padStart(4, "0")}`,
  /** "At National warehouse": where its piece waits for the fit, once it has arrived. */
  pieceAt: (place: string) => `At ${place}`,
  sendAgain: "Send link again",
  /** Asked before an order with its link out is cancelled: the link stops working. */
  cancelOrder: "Cancel order",
  cancelAsk: "Cancel this order? Its payment link stops working.",
  cancelYes: "Cancel the order",
  cancelling: "Cancelling…",
  cancelled: "Cancelled.",
  refund: "Refund in full",
  /** A paid order's row action, and the drawer it opens: "Refund CU-0007". */
  refundOpen: "Refund",
  refundLabel: (number: string) => `Refund ${number}`,
  refunded: "Refunded in full.",
  refundWhy: "Why",
  reasons: {
    not_ordered: "Not yet ordered",
    late: "Supplier late past the grace",
    failed_check: "Failed its check",
  },
  sent: "Link sent.",
  raise: {
    open: "Raise a custom order",
    title: "New custom order",
    madeTo: "Made to their profile",
    supplier: "Supplier",
    supplierPrice: (currency: string) => `Supplier’s price, ${currency}`,
    amount: "Price to the client, Rs.",
    promised: "Promised by (optional)",
    wave: "Wave",
    noWave: "As the profile says",
    note: "Note (optional)",
    send: "Raise and send the link",
    raised: "Raised. The payment link is on its way to them.",
  },
  errors: {
    profile: "Complete their hair profile first.",
    supplier_id: "That supplier is retired. Choose another.",
    order_state: changed("That order has moved on."),
    refund_not_due: "That reason doesn’t hold for this order yet.",
    unavailable: "Refund failed. Refund it in Razorpay.",
    not_found: "That client is outside your places.",
    invalid_request: "Check the order.",
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unconfirmed: UNCONFIRMED,
    unknown: FAILED,
  },
};
