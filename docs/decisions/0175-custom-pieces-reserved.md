# 0175. Custom pieces reserved

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

A custom order's piece is made for one client and paid for in full (ADR 0174). The owner ruled on 11 October 2026 that a custom piece never joins free stock.

## Decision

1. **The unit a receipt of a custom order's line labels names the custom order** (`stock_units.custom_order_id`), in the receipt's batch.
2. **It is never free stock:** a client's match to stock counts free pieces alone, held or in transit.
3. **The piece step offers it only at its client's visits:** the job card's kit leaves out every piece reserved to another client's custom order, and counts it out of what the kit holds.
4. **The order reads arrived** once its purchase order is received.

## Consequences

- A piece a client never takes becomes a case for ops; the refund rules for a late piece, or one that fails its check, come next.
- Tests: `test/worker/ops/custom-orders.test.ts`.
