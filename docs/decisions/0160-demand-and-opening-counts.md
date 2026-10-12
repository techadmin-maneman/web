# 0160. Demand ahead and opening counts

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

Phase 1 of inventory ends with two things ops need before stock can be planned: what the visits already booked will use, against what each city holds, and a way to record the stock that is already on the shelves, with its lots and expiry, when a place is first counted. The owner ruled on 11 October 2026 that a fit with no exact hair system in reach is warned of, never blocked.

## Decision

1. **The next four weeks** (`DEMAND_DAYS`): for each stock code and city, what the visits booked are expected to use, by each service's expected use (ADR 0087), beside what the city's places hold now, a kit in its technician's city. A visit's city is its technician's, or its address's.
2. **Each fit booked expects one hair system**: the stock code made exactly to its client's latest hair profile (ADR 0156), the product booked on a first fit and the profile's on a replacement.
3. **A fit is at risk** where its city holds fewer of its hair system than the fits booked there need, or its client has no profile to match one by. The Stock page lists them; nothing blocks the booking.
4. **An opening count names a lot.** A count that finds more than the ledger held may name the lot and expiry of what it found; the rest of a count up stays of no known lot, and a count names no lot unless ops give one.
5. `GET /api/stock/demand` keeps to the caller's cities; the Stock page reads it in its own panel.

## Consequences

- A Tasks group for fits at risk, and the forecast that drafts orders from this demand, come in later phases.
- Tests: `test/worker/ops/stock-demand.test.ts`, `e2e/ops/stock.e2e.ts`.
