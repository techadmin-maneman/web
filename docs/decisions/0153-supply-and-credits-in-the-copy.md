# 0153. Supply and credits in the copy

- Status: accepted
- Date: 2026-10-12
- Topic: Platform

## Context

The Finance and Supply dashboards need the stock ledger and what free visits are owed. Books' expenses, contribution margin and the reconciliation with Books are read in Zoho from Books' own connector beside our rows; supply measures come from today's ledger until the inventory phases add their own.

## Decision

1. **The reporting copy holds each consumable and each place stock is kept**: the central store, and each technician's kit with its city.
2. **Every stock movement** is a row: its day, place, consumable, kind (received, transferred, used, counted, written off), quantity and value, and the visit it was used on.
3. **Each week's position per place and consumable**, from the week of its first movement: on hand at the week's end and its value, what visits used, what the visits done were expected to use by the job sheet's usage, and whether it ended at or below its reorder level. Values are at today's unit cost.
4. **Every entry of the credit ledger** is a row, signed as the ledger keeps it and valued at a standard service visit's price on its day, so what is owed reads at any date.
5. **Kits of technicians and clients marked as tests are left out**; an erased client's credit entries stay, with no key.

## Consequences

- When inventory lots carry landed cost, value moves to the lot's cost, and alerts follow the inventory's own.
- Tests: `test/worker/jobs/analytics-nightly.test.ts`.
