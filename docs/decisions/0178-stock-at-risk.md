# 0178. Stock at risk

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

The owner ruled on 11 October 2026 that a booking with no stock in reach is never blocked: it is warned of, as a "Stock at risk" task, so ops have days to put it right. The stock demand already finds such fits (ADR 0160).

## Decision

1. **Each hour, the stock watch finds the fits booked in the weeks ahead that are at risk:** their client's profile matches no stock code, or their city holds fewer of it than its fits by then need. It reads only the codes those fits need, by their keys.
2. **Each is kept once in `stock_risks`,** and cleared once it is no longer at risk: its hair system now held in its city, its profile matched, or the visit moved or called off. A visit at risk again opens again.
3. **Each open risk is a "Stock at risk" task** on the Tasks board for Operations, due two days on and never later than the fit, naming the stock code it needs, or that no code matches the profile.

## Consequences

- The evening check of tomorrow's kits, and the top-ups it drafts, come with the supply plan.
- Tests: `test/worker/purchasing/stock-demand.test.ts`.
