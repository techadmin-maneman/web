# 0172. Supplier scorecard

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

Orders, receipts and claims now record each supplier's delivery (ADR 0166, 0167, 0169). Purchasing needs to see at a glance which suppliers keep their word.

## Decision

1. **Operations › Purchasing scores each supplier** not retired, over the last twelve months, read with Operations VIEW.
2. **On time in full:** of its orders received or closed short with a known due day, the share received in full by it. An order's due day is the day it was expected, else the day its longest line's promised lead time ends.
3. **Lead time:** the average days from sending an order to its first receipt, beside the average promised.
4. **Quality:** of every unit that arrived, the share damaged and the share that failed its check.
5. **Claims:** how many were accepted of those settled, and what was credited.
6. The rules are `src/policy/supplier-scorecard.ts`; nothing is stored, each figure is read when asked.

## Consequences

- A supplier's promised lead time is read as it is listed today, not as it was when ordered.
- Tests: `test/node/policy/supplier-scorecard.test.ts`, `test/worker/purchasing/supplier-claims.test.ts`, `e2e/ops/supplier-claims.e2e.ts`.
