// The Partner commission page's words (Finance; docs/decisions/0124-partner-statements.md). The page imports them
// itself, so they stay out of the console's first load.

import { FAILED, NOT_PERMITTED, OFFLINE } from "./common.ts";

export const partnerCommission = {
  title: "Partner commission",
  month: "Month",
  soFar: (month: string) => `${month}, so far`,
  none: "Nothing this month.",
  download: "Download month",
  downloadName: (month: string) => `partner-commission-${month}.csv`,
  columns: {
    partner: "Partner",
    fitted: "Fits",
    earned: "Earned",
    takenBack: "Taken back",
    due: "Due",
    paid: "Paid",
    owed: "Owed",
    actions: "Actions",
  },
  empty: "—",
  paid: (amount: string, day: string) => `${amount} · ${day}`,
  statement: "Statement",
  statementLabel: (name: string) => `Download the statement for ${name}`,
  statementName: (code: string, month: string) => `statement-${code}-${month}.csv`,
  record: "Record payment",
  recordLabel: (name: string) => `Record the payment to ${name}`,
  deletePayment: "Delete payment",
  deletePaymentLabel: (name: string) => `Delete the payment to ${name}`,
  /** What the delete asks about: "the payment to Looks Salon for September 2026". */
  paymentTo: (name: string, month: string) => `the payment to ${name} for ${month}`,
  form: {
    title: (name: string, month: string) => `Payment to ${name}, ${month}`,
    amount: "Paid, in rupees",
    paidOn: "Paid on",
    reference: "Reference",
    next: "Review",
    cancel: "Cancel",
  },
  /** The check before a payment is recorded. */
  check: {
    title: "Review the payment",
    line: (amount: string, day: string, reference: string) => `${amount} paid on ${day}, reference ${reference}.`,
    short: (due: string) => `Less than the ${due} due.`,
    send: "Confirm",
    saving: "Saving",
    back: "Back",
  },
  done: { recorded: "Payment recorded.", deleted: "Payment deleted." },
  /** The statement a partner is sent: days and amounts, never a client. */
  statementFile: {
    partner: "Partner",
    month: "Month",
    head: ["Day", "Line", "Commission (Rs.)"],
    fitted: "Friend fitted",
    takenBack: "Taken back: first fit refunded",
    due: "Due for the month",
    paid: (day: string, reference: string) => `Paid ${day}, reference ${reference}`,
  },
  /** The month's file, a row each partner, for the payout tool. */
  monthFile: [
    "Partner",
    "Code",
    "Fits",
    "Earned (Rs.)",
    "Taken back (Rs.)",
    "Due (Rs.)",
    "Paid (Rs.)",
    "Paid on",
    "Reference",
    "Owed (Rs.)",
  ],
  errors: {
    month: "Only a month that has ended.",
    paid_on: "A day from the month's first to today.",
    amount: "A whole amount, up to the most one payment may be.",
    reference: "The payout's reference, in letters and digits.",
    taken: "Already recorded for this month. Reload.",
    not_found: "Not found. Reload.",
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unknown: FAILED,
  },
};
