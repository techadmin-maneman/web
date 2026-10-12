# 0168. Bills in Books

- Status: accepted
- Date: 2026-10-12
- Topic: Money and Books

## Context

Receipts record what a supplier delivered against a purchase order, at the price ordered (ADR 0167). The accounts need each as a bill payable to the supplier. The owner named the two expense accounts on 12 October 2026: Cost of Goods Sold, and Raw Materials and Consumables. How closing stock is valued waits on the CA (INV-2).

## Decision

1. **A supplier becomes a Books vendor once,** the first time it has a receipt to bill: found by its name, else made with its GSTIN, currency, contact and payment terms. Its ID is kept on `suppliers.books_vendor_id`.
2. **A receipt becomes one bill,** of what the supplier invoiced: every unit received, damaged or failing its check, at the order line's price, in the order's currency at the receipt's rupee rate. Its number is the supplier's invoice number, its due date the receipt's day plus the supplier's payment terms, and its reference our receipt's ID, by which a bill whose answer never came is found before another is made. Its ID is kept on `receipts.books_bill_id`.
3. **Each line posts by what it is:** a hair system's to Cost of Goods Sold, a consumable's to Raw Materials and Consumables, as `BOOKS_BILL_ACCOUNTS` in `src/config/environments.ts` names them: a constant, since mm-api is at the limit of 64 variables and secrets (ADR 0009), and staging and production share the org. Where none are named, no vendor or bill is made.
4. **It is a step of the hourly Books pass,** before refunds, five receipts a pass. A refusal reaches ops as `books_vendor_…` or `books_bill_…`, and is tried again an hour on.
5. **Staging's vendors carry staging's label,** since staging shares the org with production; the clean-up of staging's records lists and deletes its bills before its vendors.
6. **Freight, duty and clearing are not on the supplier's bill.** They come from the forwarder or broker on bills of their own, entered by hand.

## Consequences

- The Worker's Books token needs `ZohoBooks.bills.ALL`; supplier claims will need `ZohoBooks.debitnotes.ALL`. The release check reads both accounts with `ZohoBooks.accountants.READ` (provisioning, step 11b).
- GST on a bill, and its input credit, wait on the CA (INV-2).
- Supplier claims become vendor credits against these bills.
- Tests: `test/worker/vendors/books-bills.test.ts`, `test/node/tooling/staging-records.test.ts`.
