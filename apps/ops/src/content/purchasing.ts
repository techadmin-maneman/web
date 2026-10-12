// Operations · Purchasing (docs/decisions/0166-purchase-orders.md). No design draws it; every word here is ours. Only the
// Purchasing page reads it, loaded when it opens.

import { FAILED, NOT_PERMITTED, OFFLINE } from "./common.ts";

export const purchasing = {
  title: "Purchasing",
  orders: "Orders",
  columns: ["Order", "Supplier", "Status", "Total", "Expected"],
  none: "No orders yet.",
  /** "PO-0007" */
  number: (number: number) => `PO-${String(number).padStart(4, "0")}`,
  states: {
    drafted: "Drafted",
    approved: "Approved",
    sent: "Sent",
    part_received: "Part received",
    received: "Received",
    closed: "Closed",
    cancelled: "Cancelled",
  } as Readonly<Record<string, string>>,
  awaitingSecond: "Awaiting a second approver",
  open: (number: string) => `Open ${number}`,
  order: {
    lines: ["Item", "Quantity", "Price each", "Line total"],
    total: "Total",
    expected: (date: string) => `Expected ${date}`,
    approve: "Approve",
    secondApprove: "Give second approval",
    send: "Mark sent",
    print: "Print",
    cancel: "Cancel order",
    reason: "Why it is cancelled",
    confirmCancel: "Cancel the order",
    keep: "Keep it",
    approved: "Approved.",
    sent: "Marked sent.",
    cancelled: "Cancelled.",
    cancelledWhy: (reason: string) => `Cancelled: ${reason}`,
  },
  draft: {
    title: "New order",
    supplier: "Supplier",
    item: "Item",
    quantity: "Quantity",
    addLine: "Add a line",
    removeLine: (name: string) => `Remove ${name}`,
    minimum: (minimum: number, pack: number) => `Minimum ${String(minimum)}, packs of ${String(pack)}`,
    expected: "Expected on (optional)",
    note: "Note (optional)",
    total: (total: string) => `Total ${total}`,
    send: "Draft order",
    drafted: "Drafted.",
    noItems: "This supplier lists nothing yet. Add its items in Settings, Suppliers.",
  },
  sheet: { title: "Purchase order", date: "Date", supplier: "To" },
  receive: {
    open: "Receive",
    title: "What arrived",
    received: "Accepted",
    damaged: "Damaged",
    failed: "Failed check",
    lot: "Lot (optional)",
    expires: "Expires (optional)",
    invoice: "Supplier invoice (optional)",
    rate: (currency: string) => `Rupees to one ${currency}`,
    freight: "Freight, rupees",
    duty: "Duty, rupees",
    clearing: "Clearing, rupees",
    send: "Record receipt",
    done: "Received. Print the labels on the Stock page.",
    cancel: "Not now",
    close: "Close short",
    closed: "Closed short.",
  },
  receipts: {
    title: "Receipts",
    /** "21 Sep · INV-88" */
    line: (date: string, invoice: string | null) => (invoice === null ? date : `${date} · ${invoice}`),
    /** "Solvent: 24 accepted, 2 damaged · Rs. 55 landed" */
    item: (line: { name: string; received: number; damaged: number; failed: number; landed: string }) =>
      [
        `${line.name}: ${String(line.received)} accepted`,
        line.damaged > 0 ? `${String(line.damaged)} damaged` : null,
        line.failed > 0 ? `${String(line.failed)} failed check` : null,
      ]
        .filter((part) => part !== null)
        .join(", ") + ` · ${line.landed} landed`,
  },
  errors: {
    supplier_id: "That supplier is retired or gone. Reload.",
    lines: "Each item once, at least its minimum.",
    rupee_rate: "Give the rupee rate for this currency.",
    order_state: "That order has moved on. Reload.",
    not_found: "That order is gone. Reload.",
    invalid_request: "Check the lines.",
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unknown: FAILED,
  } as Readonly<Record<string, string>>,
};
