// Razorpay's settlements in Books (docs/decisions/0261-razorpay-money-in-books.md), each Books pass: the payout as a
// transfer from Razorpay's account to the bank, under the bank's reference for it, and Razorpay's fee as an expense
// paid out of Razorpay's account, its GST as input credit once GST is on and Razorpay's GSTIN is set, at the rate
// Razorpay's own figures come to (docs/decisions/0274-gst-on.md). Razorpay's account in Books then holds what Razorpay
// still owes us, and the bank's line matches the transfer by its reference.

import { indiaDate } from "../../lib/india-time.ts";
import type { NewBooksExpense } from "../../providers/books/index.ts";
import { closeFailures, tellFailure, type Pass } from "./books-pass.ts";
import { PER_PASS } from "./vendor-pass.ts";

/**
 * Where a settlement's entries post: Razorpay's account, the bank's, and the fee's expense account; and whose GST the
 * fee carries, Razorpay's GSTIN and state as its tax invoice to us names them, and ours. Null while either is unset.
 */
export interface SettlementAccounts {
  readonly razorpay: string;
  readonly bank: string;
  readonly fees: string;
  readonly feesGst: {
    readonly supplierGstin: string;
    readonly sourceState: string;
    readonly destinationState: string;
  } | null;
}

/** A transfer looked for and recorded, then a fee looked for and recorded. */
export const CALLS_PER_SETTLEMENT = 4;

interface SettlementRow {
  id: string;
  amount: number;
  /** Razorpay's fee, and the GST within it. */
  fees: number;
  tax: number;
  utr: string | null;
  settled_at: string;
  books_transfer_id: string | null;
  books_fee_id: string | null;
}

/** The settlements still owing an entry, oldest first, each not tried within the hour. */
export async function settlementsToRecord(pass: Pass): Promise<SettlementRow[]> {
  const { results } = await pass.db
    .prepare(
      `SELECT id, amount, fees, tax, utr, settled_at, books_transfer_id, books_fee_id
       FROM razorpay_settlements INDEXED BY razorpay_settlements_to_record
       WHERE (books_transfer_id IS NULL OR (books_fee_id IS NULL AND fees > 0))
         AND (books_checked_at IS NULL OR books_checked_at < ?1)
       ORDER BY settled_at LIMIT ?2`,
    )
    .bind(pass.recheck, PER_PASS)
    .all<SettlementRow>();
  return results;
}

/** The GST in Razorpay's fee, at the rate its fee and tax come to; null for a fee with none, or no GSTIN set. */
function feeGst(row: SettlementRow, accounts: SettlementAccounts): NewBooksExpense["gst"] {
  const { feesGst } = accounts;
  if (feesGst === null || row.tax === 0 || row.tax >= row.fees) return null;
  return {
    ...feesGst,
    percent: Math.round((row.tax * 100) / (row.fees - row.tax)),
    intraState: feesGst.sourceState === feesGst.destinationState,
  };
}

/** Takes the settlement for this pass, so an overlapping run leaves it and a failure waits an hour. */
async function claim(pass: Pass, id: string): Promise<boolean> {
  const claimed = await pass.db
    .prepare(
      `UPDATE razorpay_settlements SET books_checked_at = ?1
       WHERE id = ?2 AND (books_checked_at IS NULL OR books_checked_at < ?3) RETURNING id`,
    )
    .bind(pass.at, id, pass.recheck)
    .first();
  return claimed !== null;
}

/** True when Books has both the settlement's entries now. */
export async function recordSettlement(pass: Pass, row: SettlementRow, accounts: SettlementAccounts): Promise<boolean> {
  if (!(await claim(pass, row.id))) return false;
  const failed = {
    kind: "settlement",
    id: row.id,
    personId: null,
    what: `Razorpay's settlement ${row.id}`,
    then: "It is asked again every hour.",
  } as const;
  const { books } = pass.deps;
  const date = indiaDate(new Date(row.settled_at));
  // The bank's line carries the payout's UTR; a settlement Razorpay gave none is found by its own ID.
  const reference = row.utr ?? row.id;
  try {
    if (row.books_transfer_id === null) {
      const transferId =
        (await books.findTransfer(accounts.razorpay, reference)) ??
        (await books.recordTransfer({
          fromAccountId: accounts.razorpay,
          toAccountId: accounts.bank,
          amount: row.amount,
          date,
          reference,
          description: `${pass.label}Razorpay settlement ${row.id}`,
        }));
      await pass.db
        .prepare("UPDATE razorpay_settlements SET books_transfer_id = ?1 WHERE id = ?2")
        .bind(transferId, row.id)
        .run();
    }
    if (row.books_fee_id === null && row.fees > 0) {
      const feeId =
        (await books.findExpense(row.id)) ??
        (await books.recordExpense({
          accountId: accounts.fees,
          paidThroughAccountId: accounts.razorpay,
          amount: row.fees,
          date,
          reference: row.id,
          description: `${pass.label}Razorpay's fee on settlement ${row.id}`,
          gst: feeGst(row, accounts),
        }));
      await pass.db
        .prepare("UPDATE razorpay_settlements SET books_fee_id = ?1 WHERE id = ?2")
        .bind(feeId, row.id)
        .run();
    }
  } catch (error) {
    await tellFailure(pass, failed, error);
    return false;
  }
  await closeFailures(pass, failed);
  return true;
}
