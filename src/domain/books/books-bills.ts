// Receipts as bills in Zoho Books (docs/decisions/0168-bills-in-books.md), a step of the Books sync (./books-sync.ts):
// each supplier with a receipt to bill becomes a Books vendor, once; then each receipt becomes a bill of what the
// supplier invoiced, line by line at the price ordered, a hair system's lines on the cost of goods sold and a
// consumable's on raw materials and consumables. A bill is looked for by our receipt's reference before one is made,
// so a try whose answer never came makes no second. Staging shares the org with production, so its vendors carry
// staging's label, and none of its bills reaches a real supplier's.
//
// The freight, duty and clearing are in the landed cost, not on the supplier's bill: they come from the forwarder or
// the customs broker on bills of their own. GST on the bill waits on the CA (INV-2).

import { addDays, indiaDate } from "../../lib/india-time.ts";
import { closeFailures, tellFailure, type Pass } from "./books-pass.ts";

/** Where a bill's lines post, as Books names the accounts. */
export interface BillAccounts {
  readonly hairSystems: string;
  readonly consumables: string;
}

/** Suppliers with a receipt to bill and no vendor yet, claimed for this pass. */
export async function vendorsToAdd(pass: Pass): Promise<string[]> {
  const { results } = await pass.db
    .prepare(
      `UPDATE suppliers SET books_checked_at = ?1
       WHERE books_vendor_id IS NULL AND (books_checked_at IS NULL OR books_checked_at < ?2)
         AND id IN (SELECT o.supplier_id FROM receipts r INDEXED BY receipts_to_bill
                    JOIN purchase_orders o ON o.id = r.po_id WHERE r.books_bill_id IS NULL)
       RETURNING id`,
    )
    .bind(pass.at, pass.recheck)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

type SupplierRow = {
  id: string;
  name: string;
  gstin: string | null;
  country: string;
  currency: string;
  contact_email: string | null;
  contact_phone: string | null;
  payment_terms_days: number;
};

/** The supplier made a Books vendor, its ID kept. Whether it went through. */
export async function addVendor(pass: Pass, supplierId: string): Promise<boolean> {
  const supplier = await pass.db
    .prepare(
      `SELECT id, name, gstin, country, currency, contact_email, contact_phone, payment_terms_days
       FROM suppliers WHERE id = ?1`,
    )
    .bind(supplierId)
    .first<SupplierRow>();
  if (supplier === null) return false;
  const record = {
    kind: "vendor",
    id: supplierId,
    personId: null,
    what: `supplier ${supplier.name} as a vendor`,
    then: "Its receipts wait for it.",
  } as const;
  try {
    const vendorId = await pass.deps.books.upsertVendor({
      name: `${pass.label}${supplier.name}`,
      gstin: supplier.gstin,
      currency: supplier.currency,
      inIndia: supplier.country === "IN",
      email: supplier.contact_email,
      phone: supplier.contact_phone,
      paymentTermsDays: supplier.payment_terms_days,
    });
    await pass.db.prepare("UPDATE suppliers SET books_vendor_id = ?2 WHERE id = ?1").bind(supplierId, vendorId).run();
    await closeFailures(pass, record);
    return true;
  } catch (error) {
    await tellFailure(pass, record, error);
    return false;
  }
}

/** Receipts whose supplier is a vendor and that have no bill yet, claimed for this pass, oldest first. */
export async function receiptsToBill(pass: Pass): Promise<string[]> {
  const { results } = await pass.db
    .prepare(
      `UPDATE receipts SET books_checked_at = ?1
       WHERE id IN (SELECT r.id FROM receipts r INDEXED BY receipts_to_bill
                    JOIN purchase_orders o ON o.id = r.po_id JOIN suppliers s ON s.id = o.supplier_id
                    WHERE r.books_bill_id IS NULL AND s.books_vendor_id IS NOT NULL
                      AND (r.books_checked_at IS NULL OR r.books_checked_at < ?2)
                    ORDER BY r.received_at LIMIT ?3)
       RETURNING id`,
    )
    .bind(pass.at, pass.recheck, BILLS_PER_PASS)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

/** How many receipts one pass bills at most; the next pass takes the rest. */
const BILLS_PER_PASS = 5;

type BillRow = {
  received_at: string;
  supplier_invoice: string | null;
  rupee_rate: number;
  number: number;
  vendor_id: string;
  payment_terms_days: number;
};

type BillLineRow = { name: string; unit_price: number; invoiced: number; hair_system: number };

/** The receipt made a bill, its ID kept. Whether it went through. */
export async function billReceipt(pass: Pass, receiptId: string, accounts: BillAccounts): Promise<boolean> {
  const receipt = await pass.db
    .prepare(
      `SELECT r.received_at, r.supplier_invoice, r.rupee_rate, o.number, s.books_vendor_id AS vendor_id,
         s.payment_terms_days
       FROM receipts r JOIN purchase_orders o ON o.id = r.po_id JOIN suppliers s ON s.id = o.supplier_id
       WHERE r.id = ?1`,
    )
    .bind(receiptId)
    .first<BillRow>();
  if (receipt === null) return false;
  const { results: lines } = await pass.db
    .prepare(
      `SELECT c.name, p.unit_price, l.received + l.damaged + l.qc_failed AS invoiced,
         EXISTS (SELECT 1 FROM hair_systems h WHERE h.code = p.consumable_code) AS hair_system
       FROM receipt_lines l JOIN po_lines p ON p.id = l.po_line_id JOIN consumables c ON c.code = p.consumable_code
       WHERE l.receipt_id = ?1 AND l.received + l.damaged + l.qc_failed > 0 ORDER BY l.rowid`,
    )
    .bind(receiptId)
    .all<BillLineRow>();
  const order = `PO-${String(receipt.number).padStart(4, "0")}`;
  const record = {
    kind: "bill",
    id: receiptId,
    personId: null,
    what: `the bill of ${order}'s receipt`,
    then: "It is tried again within the hour.",
  } as const;
  try {
    const found = await pass.deps.books.findBill(receiptId);
    const date = indiaDate(new Date(receipt.received_at));
    const bill =
      found ??
      (await pass.deps.books.createBill({
        vendorId: receipt.vendor_id,
        reference: receiptId,
        billNumber: receipt.supplier_invoice ?? `${order}-${receiptId.slice(0, 8)}`,
        date,
        dueDate: addDays(date, receipt.payment_terms_days),
        exchangeRate: receipt.rupee_rate / 100,
        lines: lines.map((line) => ({
          description: `${pass.label}${line.name} (${order})`,
          accountId: line.hair_system === 1 ? accounts.hairSystems : accounts.consumables,
          unitPrice: line.unit_price,
          quantity: line.invoiced,
        })),
      }));
    await pass.db.prepare("UPDATE receipts SET books_bill_id = ?2 WHERE id = ?1").bind(receiptId, bill.id).run();
    await closeFailures(pass, record);
    return true;
  } catch (error) {
    await tellFailure(pass, record, error);
    return false;
  }
}
