# 0124. Partners' monthly statements

- Status: accepted
- Date: 2026-10-11
- Topic: Referrals

## Context

Partners earn a commission for each friend fitted (ADR 0123), recorded but not paid. The owner's scope of 11 October 2026 asked for a monthly statement of commission owed, for paying out from the payroll or payout tool, sent to each partner by us; partners have no login.

## Decision

1. **A month is India's.** A partner's month is the friends fitted in it, each at the commission kept with them, less the commission of any friend whose first fit a refund under the guarantee took back in it. A clawback now stamps `clawed_back_at`, so its taking back falls in its own month and a month already paid is never rewritten.
2. **Payments are recorded, not made.** Finance pays from the payout tool and records the payment against its month: amount, day and the tool's reference, once a month has ended and once per month. One recorded by mistake can be deleted, and the month is owed again. Both are audited with the month and the amount.
3. **Owed** is everything earned to date, less everything taken back and everything paid. It shows on Finance's Partner commission page and in Growth's Partners panel.
4. **The statement** a partner is sent is a CSV of days and amounts: each fit, each taking back, what the month came to and what was paid. It never names a client. The month's file, a row per partner, goes to the payout tool.
5. **A QR code for the counter.** Each partner's row on Referrals downloads its link as a QR code, an SVG to print, made in the browser (`uqr`).
6. **Finance's own page.** Partner commission sits under Finance, national grants only: View reads it, Manage records and deletes payments.

## Consequences

- The amount paid may be below what is due, as where tax is deducted; whether tax is deducted from partners' commission is open with the CA, and the statement shows the gross.
- Tests: `test/worker/referrals/partner-statements.test.ts`, `test/node/apps/ops/ops-partner-commission-csv.test.ts`, `e2e/ops/partner-commission.e2e.ts`.
