# 0171. Vendor credits

- Status: accepted
- Date: 2026-10-12
- Topic: Money and Books

## Context

A claim on a supplier may be settled as a credit (ADR 0169). The supplier's bill for the receipt is already in Books (ADR 0168), so the credit belongs beside it.

## Decision

1. **A claim settled as a credit becomes one vendor credit** on its supplier's vendor, in the hourly Books pass after bills, once its receipt's bill is made. Its line is the amount credited, in the order's currency at the receipt's rupee rate, on the account the bill line used: Cost of Goods Sold for a hair system, Raw Materials and Consumables otherwise.
2. **Books numbers it;** its reference is our claim's ID, by which one whose answer never came is found before another is made. Its ID is kept on `supplier_claims.books_credit_id`.
3. **It is not applied to a bill by us.** Books offers it against the supplier's bills when ops next pay them.
4. A refusal reaches ops as `books_credit_…`, tried again an hour on. Staging's clean-up deletes its vendor credits before its bills.

## Consequences

- A replacement brings no credit: the replacement arrives on an order of its own.
- Tests: `test/worker/vendors/books-bills.test.ts`, `test/worker/vendors/books-provider-purchases.test.ts`.
