# 0152. Standard costs

- Status: accepted
- Date: 2026-10-12
- Topic: Money and Books

## Context

Lifetime value is margin, not revenue: what a client paid less what their hair systems, consumables and technicians cost. Consumables already carry what each cost when used, and the per-visit rates are on the Technician pay page. What a hair system costs us has no record until inventory lots carry what was paid for each, so the owner ruled a standard cost per product, set by Finance in the console; whether that suits management figures is with the CA (AN-2).

## Decision

1. **Finance set what each first fit and replacement product costs us** on the Prices page, under Hair system costs, in whole rupees before GST. A figure stands from the day it is set; a new one starts from today, so a visit keeps the cost of its day. Finance with manage set; with view, read. Each change is audited with codes and the amount.
2. **A visit's margin** is what it earned, before GST and less refunds, less its hair system at its standard cost on a first fit or replacement, less the consumables used at their recorded cost, less the technician's rate for the visit from their grade (ADR 0122). The share of salaries comes from Books in Zoho, as the scope has it.
3. **The reporting copy's client months carry the margin** (ADR 0151). A month with a first fit or replacement whose product has no cost set has none, rather than one that looks better than it is.

## Consequences

- When inventory lots carry landed cost, the hair system's cost comes from its lot instead, and this list stays for products bought before.
- A technician's grade is read as it stands now; a visit before a change of grade is costed at the new grade's rate.
- Tests: `test/worker/money/standard-costs.test.ts`, `test/worker/jobs/analytics-nightly.test.ts`, `e2e/ops/settings-services.e2e.ts`.
