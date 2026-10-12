# 0166. Purchase orders

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

The owner ruled on 11 October 2026 that purchase orders are raised, approved and received in our console: one Operations MANAGE approver, a second above an amount set in the console, and the PO's document sent by ops themselves. Suppliers and their price lists are in (ADR 0165).

## Decision

1. **An order is a row of `purchase_orders`, its lines rows of `po_lines`**: drafted from an active supplier's list, each line a stock code it lists, at least its minimum, at the price it lists, kept on the line. Numbered PO-0001 onwards, in the supplier's currency.
2. **States**: drafted, approved, sent, part received, received, closed, or cancelled. Receipts move it on from sent.
3. **Approval**: one Operations MANAGE approver. A second, a different manager, where the order is in rupees and worth more than the amount ops set (`po_second_approval_above_rupees`, Settings › Policies › Purchasing), and always where it is in another currency, whose worth in rupees is known only once received. The amount starts at nought, so every order needs two until ops set one: nothing goes out on one person's word before they decide.
4. **Sending**: the console prints the order for ops to send themselves, then they mark it sent. Sending it automatically can come later.
5. **Cancelling**, with why, by an Operations manager, from drafted, approved or sent, before anything of it arrives.
6. **Each change is written once**: the update stamps its own token (`change_id`), and its audit entry is written only where that token stands, so two managers approving at once approve once, and a step refused for its state is never audited.
7. **Operations › Purchasing** lists open orders, then the latest settled; drafting and marking sent need Operations ACT, approving and cancelling MANAGE.

## Consequences

- Receipts against an order, with lots, labels, a quality check and landed cost, come next; then bills to Books.
- Tests: `test/worker/ops/purchase-orders.test.ts`, `e2e/ops/purchasing.e2e.ts`.
