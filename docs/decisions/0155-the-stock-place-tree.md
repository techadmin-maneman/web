# 0155. The stock place tree

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

Stock was kept in two kinds of place: one central store and each technician's kit (ADR 0087). As we open cities, stock sits in more places than that: a national warehouse, a hub serving a zone, a stockroom in a city, and the kits drawn from each. Inventory's first phase needs those places before lots, expiry, dispatch and the national, zone and city views can stand on them.

## Decision

1. **Every place stock is kept is a row of `stock_places`**, of one of four kinds: the warehouse, a hub for a zone, a stockroom in a city, and a technician's kit. Each hangs from a place above it: a hub from the warehouse, a stockroom from the warehouse or a hub, a kit from any of them. Depth follows the kind, so the tree has no loops.
2. **The ledger keeps its names.** The warehouse keeps the central store's ID, `central`, and a kit its technician's ID, so every row and balance from before reads as it did. A row at a hub or a stockroom names it in `stock_movements.place_id`; the balances are kept by `COALESCE(place_id, technician_id, 'central')`.
3. **A kit comes with its technician**, added by a trigger under the warehouse, and is named by them. Ops move it under a stockroom; it is never renamed or closed, and is open while its technician is. Deleting a technician added by mistake deletes their kit first.
4. **Ops with Operations MANAGE everywhere add hubs and stockrooms**, rename them, move them, and close one once it is empty with nothing open under it. A closed place that still holds stock keeps its column on the Stock page, as a kit of a technician who left does.
5. **Movements go between any two places**: a delivery into the warehouse, a transfer between any two, a count or a loss at any. The API names each place by `place_id`.
6. **Reach**: a kit is in its technician's city and a stockroom in its own; a hub is reached only with every city of its zone, and the warehouse only nationally.
7. **Low stock**: a kit is measured against the kit level, every other place against the central one. The warehouse keeps the `low_stock:central` alert and a kit `low_stock:kit:<technician>`; a hub or a stockroom has `low_stock:store:<place>`, by its name.
8. **The reporting copy** carries every place in `dim_stock_place`: the warehouse as `central`, kind `store`, as the dashboards know it; each other place as `<kind>:<id>`.

## Consequences

- Lots and expiry, dispatch and receipt, the views by level and the demand preview build on these places (the inventory scope's phase 1).
- Tests: `test/worker/ops/stock-places.test.ts`, `test/worker/ops/stock.test.ts`, `test/worker/ops/operations-places.test.ts`, `test/worker/jobs/analytics-nightly.test.ts`, `e2e/ops/stock.e2e.ts`.
