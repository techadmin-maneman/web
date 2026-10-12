# 0157. Lots and expiry

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

Adhesives, tapes, solvents and hair systems expire, and the owner ruled on 11 October 2026 that each stock code's shelf life is set on the console form where ops add it. Stock that expires must leave a place before stock that does not, and ops need to see what is about to expire wherever it is.

## Decision

1. **A stock code may have a shelf life**, in days, set in Settings, Consumables, as its cost and levels are. One without does not expire.
2. **A delivery brings a lot** (`stock_lots`): the supplier's lot as printed, and the day it expires. With no expiry given, the day received plus the shelf life; with no lot given, a stock code that expires is a lot named for its day (`R-20261012`), and one that does not is of no lot.
3. **Each movement is broken down by the lots it moved** (`stock_lot_moves`), and each place's holding of each lot kept by trigger (`stock_lot_balances`). The ledger's rows and balances stay as they were: a movement's lots are written in its own batch, each only where the movement is written.
4. **What leaves a place leaves from the lot that expires soonest** (a lot with no expiry last, then the earliest received): a transfer, a count down, a loss, a job's use and a piece fitted. What a transfer brings is of the lots that left. A loss may name its lot, as one that expired. A job's correction gives back to the lots the job took from, the last taken first.
5. **Stock of no known lot** (moved before lots, or counted up) stays in the balance without one. The lots a place holds can sum to less than its balance, never more.
6. **The Stock page** shows under each figure when the soonest lot there expires; a delivery takes a lot and an expiry, and a loss a lot.

## Consequences

- Two takes at once of one place's lots can each read the same lot; the balance stays right, and a count puts the lots right. The expiry view and its alerts, and lots in the reporting copy, come next in phase 1.
- Tests: `test/worker/ops/stock-lots.test.ts`, `e2e/ops/stock.e2e.ts`, `e2e/ops/consumables.e2e.ts`.
