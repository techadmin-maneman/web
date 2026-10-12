# 0188. Failure rates and value at risk

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

The scope asks for failure rates by lot, stock code, supplier and technician. It also asks that stock which won't be used before it expires is flagged weeks early, with its value at risk in rupees from lot cost, and one suggestion: move it to a busier place, use it first, return it, or write it off.

## Decision

1. **Both are read on demand on the Quality page,** never by the cron.
2. **Failure rates:** the pieces fitted from labelled stock in the last year, and how many have failed, grouped by stock code, lot, supplier (the one whose purchase order received the lot) or the technician who fitted them. Read with Operations VIEW.
3. **Value at risk:** for each lot a place holds that expires, the place's pace is what left it as use or transfers over the last 28 days. What it will not use before each lot expires is valued at the lot's landed cost, or the item's cost where it has none. Lots are used soonest-to-expire first, as every deduction takes them. Read with Operations MANAGE in the caller's places, since it values stock.
4. **One suggestion each:** write off what has expired; otherwise move it to the place that lets the item go fastest; and where no other place does, use it first. Returning to a supplier is a claim (ADR 0169), raised from Purchasing.

## Consequences

- Pieces fitted before labels have no lot, stock code or supplier on record, so they are not in the failure rates.
- A place with no recent use shows everything it holds as at risk until it uses some.
- Tests: `test/node/policy/stock-quality.test.ts`, `test/worker/ops/stock-quality.test.ts`, `test/dom/ops-quality.test.ts`, `e2e/ops/quality.e2e.ts`.
