// Operations · Purchasing (docs/decisions/0166-purchase-orders.md, 0169-supplier-claims.md). No design draws it;
// every word here is ours. Only the Purchasing page reads it, loaded when it opens.

import { amountOf } from "@maneman/web-kit/figures";
import { changed, FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

export const purchasing = {
  title: "Purchasing",
  orders: "Orders",
  // Open orders first, each group newest first, with the day it was drafted: the numbers are random to suppliers.
  columns: ["Order", "Drafted", "Supplier", "Status", "Total", "Expected"],
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
  },
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
    reason: "Reason",
    confirmCancel: "Cancel the order",
    keep: "Keep order",
    approved: "Approved.",
    /** Approve gone after the first of two approvals: who gives the second. */
    yoursFirst: "You gave its first approval. Another Operations manager gives the second.",
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
    /** "Minimum 1,000 ml, packs of 250 ml · Rs. 5 per ml" */
    minimum: (minimum: number, pack: number, unit: string, price: string) =>
      `Minimum ${amountOf(minimum, unit)}, packs of ${amountOf(pack, unit)} · ${price} per ${unit}`,
    /** A price far above what Settings say the item costs: most often a pack's price typed as one unit's. */
    farAbove: (price: string, unit: string, times: number, cost: string) =>
      `${price} per ${unit} is ${String(times)} times what Settings say one costs (${cost}). Check the supplier’s price is per ${unit}, not per pack.`,
    expected: "Expected on (optional)",
    note: "Note (optional)",
    total: (total: string) => `Total ${total}`,
    send: "Draft order",
    drafted: "Drafted.",
    noItems: "This supplier lists nothing yet. Add its items in Settings, Suppliers.",
  },
  /** The printed order (./OrderSheet.tsx): from us, to the supplier, and what to deliver where. */
  sheet: {
    title: "Purchase order",
    date: "Date",
    from: "From",
    supplier: "To",
    gstin: (gstin: string) => `GSTIN ${gstin}`,
    registeredOffice: "Registered office",
    cin: (cin: string) => `CIN ${cin}`,
    deliverTo: "Deliver to",
    /** "24 strips (2 packs of 12)" */
    quantity: (quantity: number, unit: string, pack: number | null) =>
      pack === null || pack <= 1 || quantity % pack !== 0
        ? amountOf(quantity, unit)
        : `${amountOf(quantity, unit)} (${amountOf(quantity / pack, "pack")} of ${String(pack)})`,
    columns: ["Their code", "Item", "Quantity", "Price each", "Line total"],
    payment: (days: number) => (days === 0 ? "Payment: on delivery" : `Payment: ${String(days)} days`),
    approvedBy: (who: string) => `Approved by ${who}`,
  },
  /** What a printed order says of us, which a manager sets once. */
  letterhead: {
    title: "Letterhead",
    missing: "Set the letterhead to print it on orders.",
    legalName: "Legal name",
    registeredOffice: "Registered office",
    cin: "CIN",
    gstin: "GSTIN (optional)",
    deliverTo: "Deliver to",
    deliverHint: "The address, as it prints, a line at a time.",
    save: "Save letterhead",
    saved: "Letterhead saved.",
    errors: {
      legal_name: "Give the legal name, 2 to 120 characters.",
      registered_office: "Give the address, 5 to 400 characters.",
      cin: "A CIN is 21 characters, like U74999DL2026PTC123456.",
      gstin: "A GSTIN is 15 characters, like 06AABCM1234A1Z5.",
      deliver_to: "Give the address, 5 to 400 characters.",
      not_permitted: NOT_PERMITTED,
      offline: OFFLINE,
      unknown: FAILED,
    },
  },
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
    freight: "Freight, Rs.",
    duty: "Duty, Rs.",
    clearing: "Clearing, Rs.",
    send: "Record receipt",
    done: "Received. Print the labels on the Stock page.",
    cancel: "Cancel",
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
  claims: {
    title: "Claims",
    columns: ["Claim", "Supplier", "Item", "Reason", "Status", "Value"],
    none: "No claims.",
    /** "CL-0007" */
    number: (number: number) => `CL-${String(number).padStart(4, "0")}`,
    open: (number: string) => `Open ${number}`,
    reasons: { damaged: "Damaged", qc_failed: "Failed check", warranty: "Under warranty" },
    states: {
      drafted: "Drafted",
      sent: "Sent",
      accepted: "Accepted",
      rejected: "Rejected",
      withdrawn: "Withdrawn",
    },
    outcomes: { credit: "Credited", replacement: "Replaced" },
    /** "Solvent × 2", or "Mane Man Essential 8x10 · MM-ESS-0000001-B" */
    item: (name: string, quantity: number, piece: string | null) =>
      piece === null ? `${name} × ${String(quantity)}` : `${name} · ${piece}`,
    from: (order: string) => `From ${order}`,
    note: "Note (optional)",
    send: "Mark sent",
    withdraw: "Withdraw",
    why: "Reason",
    confirmWithdraw: "Withdraw the claim",
    credit: (currency: string) => `Credit, ${currency}`,
    credited: "Record credit",
    replaced: "Replaced",
    rejected: "Rejected",
    keep: "Keep claim",
    sentSaid: "Marked sent.",
    withdrawnSaid: "Withdrawn.",
    settledSaid: "Settled.",
  },
  returns: {
    title: "Returned pieces",
    columns: ["Piece", "Item", "Returned", "Handed in at", "Warranty", ""],
    none: "Nothing to settle.",
    until: (date: string) => `Until ${date}`,
    ended: (date: string) => `Ended ${date}`,
    unknown: "No supplier on record",
    claim: "Claim",
    writeOff: "Write off",
    why: "Reason",
    confirmWriteOff: "Write it off",
    keep: "Keep stock",
    claimed: "Claim drafted. It’s in Claims.",
    writtenOff: "Written off.",
  },
  scorecard: {
    title: "Suppliers",
    note: "The last twelve months.",
    columns: [
      "Supplier",
      "Orders",
      "On time, in full",
      "Lead time",
      "Failed check",
      "Damaged",
      "Claims won",
      "Credited",
    ],
    none: "No suppliers yet.",
    percent: (value: number | null) => (value === null ? "" : `${String(value)}%`),
    /** "13.5 days (promised 14)", or "12 days" where nothing was promised. */
    days: (actual: number | null, promised: number | null) => {
      if (actual === null) return "";
      const days = `${String(actual)} ${actual === 1 ? "day" : "days"}`;
      return promised === null ? days : `${days} (promised ${String(promised)})`;
    },
    claims: (accepted: number, settled: number) => (settled === 0 ? "" : `${String(accepted)} of ${String(settled)}`),
  },
  photo: {
    writeOff: "Photo of the piece",
    claim: "Photo for the supplier (optional)",
    alt: "The photo",
    remove: "Remove photo",
    storing: "Storing the photo…",
    view: "Photo",
  },
  errors: {
    supplier_id: changed("That supplier is retired or gone."),
    lines: "Each item once, at least its minimum.",
    rate_micro_rupees: "Give the rupee rate for this currency.",
    order_state: changed("That order has moved on."),
    same_approver: "You gave its first approval. Another Operations manager gives the second.",
    custom_order: "A client’s custom order is on this order. Cancel the custom order, which refunds them.",
    claim_state: changed("That claim has moved on."),
    return_settled: changed("That piece is settled already."),
    out_of_warranty: "Its warranty has ended. Write it off instead.",
    credit_amount: "Give the credit.",
    photo_id: "Add a photo of the piece.",
    photo_invalid_file: "That photo couldn’t be read. Try another.",
    busy: "Photos are paused. Try again later.",
    not_found: changed("That order is gone."),
    invalid_request: "Each line needs an item, a quantity of 1 or more and a price.",
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unconfirmed: UNCONFIRMED,
    unknown: FAILED,
  },
};
