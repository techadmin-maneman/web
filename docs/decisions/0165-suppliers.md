# 0165. Suppliers

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

Stock arrives as deliveries recorded when they land (ADR 0087), with no record of who sent it or on what terms. The owner ruled on 11 October 2026 that purchase orders are raised, approved and received in our console, with bills in Zoho Books, and that a piece failing inside its supplier's warranty becomes a claim on that supplier. Orders, receipts, claims and the forecast's lead times all need the supplier first.

## Decision

1. **A supplier is a row of `suppliers`**: its name, GST number (none for one abroad), country, the currency its invoices are in, a contact, its payment terms and its warranty in days. It is retired, never deleted, since orders and bills will name it.
2. **What it supplies is a row of `supplier_items` per stock code**: their code, one unit's price in the supplier's currency in its smallest unit, the pack it comes in, the least they take, and the lead time they promise. The lead time learned from receipts comes with them.
3. **Admin keeps them**, in Settings, Suppliers, with Admin MANAGE: each change checked old beside new before it is sent (ADR 0071), and audited.
4. **A consumable a supplier lists is not deleted**: its foreign key refuses the batch, answered `in_use`, as one whose stock has moved.

## Consequences

- Purchase orders, receipts with a quality check, bills to Books and supplier claims build on suppliers. No price is kept anywhere but here and on the documents that copy it.
- Tests: `test/worker/purchasing/suppliers.test.ts`, `e2e/ops/suppliers.e2e.ts`.
