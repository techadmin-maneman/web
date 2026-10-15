# 0159. Stock views and expiry

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

With stock held at a warehouse, hubs, stockrooms and kits (ADR 0155), in lots that expire (ADR 0157) and in transit between them (ADR 0158), ops need to see it by level, national, zone and city, and be told what expires before it does, and what has gone missing on the way.

## Decision

1. **Totals by level.** The Stock page shows each place, or adds up every place within reach for all of them and for each zone or city. A kit counts in its technician's city, and in that city's zone.
2. **Expiring.** The Stock page lists every lot within reach that expires within 30 days (`EXPIRY_WARNING_DAYS`), or has, soonest first, with where it is and how much.
3. **A morning alert for each place** holding such a lot (`stock_expiring:<place>`), naming each lot, a kit by its technician's ID alone, in the hour from 9 am in India; it closes once the place holds none of them.
4. **A morning alert for each transfer** still on its way 7 days after it was sent (`transfer_overdue:<transfer>`); it closes once the transfer is received or sent back.
5. **The Stock page loads when opened**, as Settings does, so its panels never weigh on the console's first load.

## Consequences

- The thirty and seven days are figures in `src/policy/stock.ts`; they become settings if ops ask.
- The morning look reads only the lots still held (a partial index) and the transfers on their way.
- Tests: `test/worker/inventory/stock-watch.test.ts`, `e2e/ops/stock.e2e.ts`.
