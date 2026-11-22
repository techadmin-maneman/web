# 0175. Custom pieces reserved

- Status: accepted. Amended 22 November 2026: a client's own reserved piece counts in their match, and Stock and the order show where it is.
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
- Tests: `test/worker/purchasing/custom-orders.test.ts`.

## Amended 22 November 2026: the client sees their own piece

A piece that arrived for a custom order read as "None held yet" on its own client's match, and as free stock on Stock, so ops could not tell it was there for that client. Point 2 now reads:

2. **It is never free stock to anyone else:** a client's match counts free pieces and the pieces reserved to their own custom orders, and says how many of each place's are theirs; every other client's match counts free pieces alone. Stock says how many of a place's pieces are reserved, and the client's order says where its piece is held.

A paid order and its arrived piece each wait on the board as a task until its purchase order is sent and its fit is booked (`src/domain/ops/custom-order-tasks.ts`).
