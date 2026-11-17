# 0261. Razorpay's money in Books, from payment to the bank

- Status: accepted
- Date: 2026-11-17
- Topic: Money and Books
- Builds on [0044](0044-payments-mirror.md), "Receipts in Books", and [0257](0257-razorpay-only.md)
- Supersedes [0200](0200-staging-tenants-of-its-own.md) for Books: one organisation serves both environments

## Context

A Razorpay payment reached Books as a customer payment naming no account, so it sat in Undeposited Funds, while a
refund left from a separate bank account. Razorpay does not pay us each payment: it holds the money and settles it to
the bank on its own schedule, less its fee and the GST on that fee. Nothing recorded a settlement, so Books could not
match the bank's line to the payments in it (open point 17). A kept charge, such as a late cancel's, sat in Books as
the client's credit, and ops settled it by hand (open point 16). Orders asked Razorpay for no capture, so live mode
depended on the account's own setting (open point 154).

The owner asked on 17 November 2026 for the recommended design, built as one change. Books keeps one organisation for
staging and production, and its one account for Razorpay's money is "Razorpay Clearing", a payment clearing account.

## Decision

1. **Capture.** Each order asks Razorpay to capture its payment itself, within 12 minutes of authorisation, and refunds
   at normal speed (`createOrder`, `src/providers/payments/razorpay.ts`).
2. **Payments into Razorpay Clearing.** A Razorpay payment is deposited to the account `BOOKS_REFUND_ACCOUNT_ID` names,
   the one a refund leaves. A UPI payment recorded by ops names none, as its money is ours already.
3. **Settlements kept.** Each processed settlement is kept once in `razorpay_settlements` (migration 0216): from the
   `settlement.processed` webhook, or from the hourly catch-up, which reads Razorpay's settlements of the last 7 days
   (`src/domain/money/razorpay-settlements.ts`). A settlement not yet processed is not money in the bank, and waits.
4. **Settlements in Books.** Each Books pass records a kept settlement as two entries, each looked for by its reference
   before it is recorded (`src/domain/books/books-settlements.ts`):
   - a transfer of the amount paid out from Razorpay Clearing to the bank (`BOOKS_BANK_ACCOUNT_ID`), under the payout's
     UTR, which the bank's line carries, else the settlement's ID;
   - Razorpay's fee as an expense in `BOOKS_GATEWAY_FEES_ACCOUNT_ID`, paid out of Razorpay Clearing, under the
     settlement's ID. Once GST is on, `BOOKS_GATEWAY_FEES_TAX_ID` names the fee's tax, the amount including it, so its
     GST is input credit.
     Razorpay Clearing then holds what Razorpay still owes us, and staging's labelled test payments and refunds until
     staging's records are cleared. Settlements are recorded in production alone, once Razorpay Clearing, the bank and
     the fee's account are all set, as the one Books organisation's bank is the real one; a failure is asked again each
     hour and told to ops as every Books record's is.
5. **A kept charge invoiced.** The CA ruled that a kept charge is invoiced, the amount kept including 18% GST. Each
   Books pass raises its own invoice under the payment's ID, on the visit's Books item, one line ("Late cancellation
   charge, First Fit"; "No-show charge, …"; "Late move charge, …"), sends it, and sets the payment against it
   (`src/domain/books/books-kept.ts`). A no-show's charge waits until its dispute window has closed with no dispute
   open, as a dispute may give it all back. An invoice found voided is told to ops to settle by hand, as before, and so
   is an erased client's charge. The invoice's ID is kept on the payment (`books_kept_invoice_id`), so staging's
   clean-up finds it, and a refund of the payment that Books refuses names the invoice ops credit first.

## Consequences

- The Worker's Books token needs `ZohoBooks.banking.CREATE`, `ZohoBooks.expenses.READ` and `ZohoBooks.expenses.CREATE`,
  and production's webhook `settlement.processed` (`docs/go-live.md`).
- Staging and production share the Books organisation and the account IDs, so the config check
  (`scripts/lib/wrangler-config-check.ts`) no longer refuses them shared; it still refuses a shared Razorpay key.
  Staging names Razorpay Clearing, its payments and refunds there carrying "Staging test", but neither the bank nor
  the fee's account, and its webhook leaves `settlement.processed` off.
- A kept charge refunded after its invoice is issued: Books refuses the refund until ops credit the invoice, and ops
  are told which one. Before, the kept money sat as the client's credit and the refund went through.
- A no-show charge's invoice comes once its dispute window, 30 days by default, has closed; the CA is asked whether
  that is in time (open point 16).
