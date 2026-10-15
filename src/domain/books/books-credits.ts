// Claims credited, as vendor credits in Zoho Books (docs/decisions/0171-vendor-credits.md), a step of the Books sync
// (./books-sync.ts) after bills: each claim a supplier settled as a credit becomes a vendor credit on its vendor, of
// the amount credited, on the account its receipt's bill line used. It waits for that bill, so the credit sits beside
// it; Books applies it to the bill, or to the next, when ops pay. Looked for by our claim's ID before one is made.

import { MICRO_PER_RUPEE } from "../../config/currencies.ts";
import { indiaDate } from "../../lib/india-time.ts";
import type { BillAccounts } from "./books-bills.ts";
import { closeFailures, tellFailure, type Pass } from "./books-pass.ts";

/** How many claims one pass credits at most; the next pass takes the rest. */
const CREDITS_PER_PASS = 5;

/** Claims credited whose receipt is billed and that have no vendor credit yet, claimed for this pass, oldest first. */
export async function claimsToCredit(pass: Pass): Promise<string[]> {
  const { results } = await pass.db
    .prepare(
      `UPDATE supplier_claims SET books_checked_at = ?1
       WHERE id IN (SELECT k.id FROM supplier_claims k INDEXED BY supplier_claims_to_credit
                    JOIN receipt_lines l ON l.id = k.receipt_line_id JOIN receipts r ON r.id = l.receipt_id
                    WHERE k.outcome = 'credit' AND k.books_credit_id IS NULL AND r.books_bill_id IS NOT NULL
                      AND (k.books_checked_at IS NULL OR k.books_checked_at < ?2)
                    ORDER BY k.decided_at LIMIT ?3)
       RETURNING id`,
    )
    .bind(pass.at, pass.recheck, CREDITS_PER_PASS)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

type CreditRow = {
  number: number;
  order_number: number;
  name: string;
  credit_amount: number;
  decided_at: string;
  rate_micro: number;
  currency: string;
  vendor_id: string | null;
  hair_system: number;
};

/** The claim made a vendor credit, its ID kept. Whether it went through. */
export async function creditClaim(pass: Pass, claimId: string, accounts: BillAccounts): Promise<boolean> {
  const claim = await pass.db
    .prepare(
      `SELECT k.number, o.number AS order_number, c.name, k.credit_amount, k.decided_at,
         COALESCE(r.rate_micro, r.rupee_rate * 10000) AS rate_micro, o.currency,
         s.books_vendor_id AS vendor_id,
         EXISTS (SELECT 1 FROM hair_systems h WHERE h.code = k.consumable_code) AS hair_system
       FROM supplier_claims k JOIN consumables c ON c.code = k.consumable_code
         JOIN receipt_lines l ON l.id = k.receipt_line_id JOIN receipts r ON r.id = l.receipt_id
         JOIN purchase_orders o ON o.id = r.po_id JOIN suppliers s ON s.id = k.supplier_id
       WHERE k.id = ?1`,
    )
    .bind(claimId)
    .first<CreditRow>();
  const vendorId = claim?.vendor_id ?? null;
  if (claim === null || vendorId === null) return false;
  const number = `CL-${String(claim.number).padStart(4, "0")}`;
  const order = `PO-${String(claim.order_number).padStart(4, "0")}`;
  const record = {
    kind: "credit",
    id: claimId,
    personId: null,
    what: `the credit of claim ${number}`,
    then: "It is tried again within the hour.",
  } as const;
  try {
    const found = await pass.deps.books.findVendorCredit(claimId);
    const credit =
      found ??
      (await pass.deps.books.createVendorCredit({
        vendorId,
        reference: claimId,
        creditNumber: `${pass.label}${number}`,
        date: indiaDate(new Date(claim.decided_at)),
        exchangeRate: claim.rate_micro / MICRO_PER_RUPEE,
        currency: claim.currency,
        lines: [
          {
            description: `${pass.label}${claim.name} (${number}, ${order})`,
            accountId: claim.hair_system === 1 ? accounts.hairSystems : accounts.consumables,
            unitPrice: claim.credit_amount,
            quantity: 1,
          },
        ],
      }));
    await pass.db
      .prepare("UPDATE supplier_claims SET books_credit_id = ?2 WHERE id = ?1")
      .bind(claimId, credit.id)
      .run();
    await closeFailures(pass, record);
    return true;
  } catch (error) {
    await tellFailure(pass, record, error);
    return false;
  }
}
