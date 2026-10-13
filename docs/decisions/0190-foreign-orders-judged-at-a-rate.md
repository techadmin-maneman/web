# 0190. Foreign orders judged at a rate

- Status: accepted
- Date: 2026-10-13
- Topic: Field work

## Context

ADR 0166 made every purchase order in another currency need a second approver, since its worth in rupees is known only once received. With one Operations manager, no order in dollars could be sent, a paid custom order from the overseas supplier included. The owner chose one approver below an amount.

## Decision

1. **A rate per currency.** The setting `po_rupees_to_one`, keyed by currency code, holds what one unit is worth in rupees for approvals.
2. **The same amount for all.** An order in another currency is judged at its rate against `po_second_approval_above_rupees`, as a rupee order is.
3. **No rate, two approvers.** A currency with no rate set, or nought, still needs a second approver.
4. **Never the same person twice.** The manager who gave the first approval is not offered the second, and asking is refused as `same_approver`.

## Consequences

- The rate is ops' own, for approvals only; a receipt still records the rupee rate it landed at.
- Tests: `test/worker/ops/purchase-orders.test.ts`, `e2e/ops/purchasing.e2e.ts`.
