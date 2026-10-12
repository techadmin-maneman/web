# 0167. Receipts and landed cost

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

Purchase orders are drafted, approved and sent (ADR 0166). The owner ruled on 11 October 2026 that receiving happens at the national warehouse, where each line is counted with its lot and expiry and labelled; that short, extra and damaged stock is recorded against the order; that a hair system that fails its check never becomes stock; and that stock is valued at its lot's landed cost: the supplier's price plus a share of the receipt's freight, duty and clearing.

## Decision

1. **A receipt is a row of `receipts`, its lines rows of `receipt_lines`**, against an order sent or part received: for each order line, how many were accepted, damaged or failed their check, the lot and expiry, and what one cost landed. A receipt may bring more than ordered, or less.
2. **What is accepted enters the warehouse as a delivery does** (ADR 0157, 0161): in its lot, and each hair system piece labelled. The damaged and those that failed their check never enter stock; a claim on the supplier comes with supplier claims.
3. **Landed cost**: one unit's supplier price, in the order's currency, at the receipt's rupee rate (paise to one unit of that currency; rupees are 100), plus the line's share of the freight, duty and clearing by the value it brought (by count where nothing brought value). It is kept on the receipt line and on the lot (`stock_lots.landed_cost_paise`, its latest receipt's).
4. **The order moves on**: received once every line has all it ordered, part received until then. An Operations manager may close one part received short.
5. **Operations › Purchasing** receives an order sent or part received with Operations ACT, and lists each receipt with its lines and landed cost.

## Consequences

- Each receipt becomes a bill in Zoho Books next; how stock value and cost of goods reach the accounts waits on the CA (INV-2).
- The supplier scorecard reads actual lead times and failed checks from receipts.
- Tests: `test/worker/ops/receipts.test.ts`, `e2e/ops/purchasing.e2e.ts`.
