// Payments and refunds written to Zoho Books, so Books issues their receipts
// (docs/decisions/0044-payments-mirror.md, "Receipts in Books"). It runs on the
// five-minute cron, not in the payment's path: Books is never on the way to a
// booking.
//
// Each pass does a little of six things, oldest first:
//   - makes the Books customer of each client with money or a finished visit to
//     record (src/domain/books/books-customers.ts);
//   - writes a client's new number or address to their customer;
//   - records each captured payment whose client Books has, once, with what it
//     was for, which the receipt prints as its description of supply;
//   - applies a visit's payment to its invoice, once Books has sent it, and tells
//     ops of any part the invoice did not owe;
//   - tells ops of money kept that no invoice will come to be set against: what
//     a late cancel or replacement kept, a no-show's charge, and a late fee
//     (src/domain/books/books-kept.ts);
//   - records each processed refund of a recorded payment, from the account
//     Razorpay settles into, when that account is set.
//
// Each record is claimed before Books is asked, so a run that overlaps the one
// before it leaves the records that one is on. A payment or a refund is also
// looked for in Books by our reference before it is recorded, so a try whose
// answer never came is not recorded a second time.
//
// Each record is handled on its own (docs/decisions/0067-alerts-and-silent-failures.md).
// One found not ready, or that fails, waits an hour before Books is asked again,
// as Books allows a few thousand calls a day, and the pass carries on with the
// rest. A refusal is told to ops at once; any other failure once it has
// happened three times. Each record is paid for from the cron run's outside
// calls first, and the pass stops when they are spent.
//
// The pass, with its claims and its failures, is ./books-pass.ts; the customers are ./books-sync-customers.ts, and
// the payments and refunds ./books-sync-payments.ts.

import type { CallBudget } from "../../lib/call-budget.ts";
import { type Logger } from "../../log.ts";
import { keptMoney, keptSinceRefunded, alertKeptMoney } from "./books-kept.ts";
import { RECHECK_AFTER_MS } from "./vendor-pass.ts";
import type { BooksSyncDeps, BooksSyncOptions, Pass } from "./books-pass.ts";
import { customersToAdd, addCustomer, customersToUpdate, updateCustomer } from "./books-sync-customers.ts";
import {
  paymentsToRecord,
  recordPayment,
  paymentsToApply,
  applyPayment,
  refundsToRecord,
  recordRefund,
} from "./books-sync-payments.ts";

/** Outside calls one record may cost: Books' look for it, Books' record, and the alert it may send. */
export const CALLS_PER_RECORD = 3;
/** Outside calls one customer may cost: Books' write, and the alert it may send. */
export const CALLS_PER_CUSTOMER = 2;

export type BooksSyncSummary = {
  customers: number;
  customersUpdated: number;
  recorded: number;
  applied: number;
  refunded: number;
};

export async function syncBooks({
  db,
  deps,
  options,
  now,
  log,
  budget,
}: {
  db: D1Database;
  deps: BooksSyncDeps;
  options: BooksSyncOptions;
  now: Date;
  log: Logger;
  budget: CallBudget;
}): Promise<BooksSyncSummary> {
  const pass: Pass = {
    db,
    deps,
    options,
    log,
    at: now.toISOString(),
    recheck: new Date(now.getTime() - RECHECK_AFTER_MS).toISOString(),
    label: options.labelAsTest ? "Staging test: " : "",
  };
  const summary: BooksSyncSummary = { customers: 0, customersUpdated: 0, recorded: 0, applied: 0, refunded: 0 };

  for (const personId of await customersToAdd(pass)) {
    if (!budget.spend(CALLS_PER_CUSTOMER)) return summary;
    if (await addCustomer(pass, personId)) summary.customers += 1;
  }
  for (const personId of await customersToUpdate(pass)) {
    if (!budget.spend(CALLS_PER_CUSTOMER)) return summary;
    if (await updateCustomer(pass, personId)) summary.customersUpdated += 1;
  }
  for (const payment of await paymentsToRecord(pass)) {
    if (!budget.spend(CALLS_PER_RECORD)) return summary;
    if (await recordPayment(pass, payment)) summary.recorded += 1;
  }
  for (const payment of await paymentsToApply(pass)) {
    if (!budget.spend(CALLS_PER_RECORD)) return summary;
    if (await applyPayment(pass, payment)) summary.applied += 1;
  }
  for (const kept of await keptMoney(db)) {
    if (!budget.spend(1)) return summary;
    await alertKeptMoney(db, deps.alertOnce, pass.at, kept);
  }
  for (const paymentId of await keptSinceRefunded(db)) await deps.resolveAlert(`books_unapplied:${paymentId}`);
  if (options.refundAccountId === null) return summary;
  for (const refund of await refundsToRecord(pass)) {
    if (!budget.spend(CALLS_PER_RECORD)) return summary;
    if (await recordRefund(pass, refund, options.refundAccountId)) summary.refunded += 1;
  }
  return summary;
}
