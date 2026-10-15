# 0173. Matching a client to stock

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

The owner ruled on 11 October 2026 that a hair system matches a client only exactly: product, base size, colour, grey and density, never cut down. A client with no stocked match pays for a custom order.

## Decision

1. **A client's match is read from their latest hair profile's spec alone**, never its history: the one stock code whose product, base width and length, colour, grey and density are all theirs (`matchingCode` in `src/domain/inventory/hair-systems.ts`, which the stock demand uses too).
2. **Missing any of those, the profile says which.** With every one given and no code made to it, the client's is a custom order.
3. **A match shows where its pieces are held,** each place with its count, the client's city first, and how many are in transit.
4. **On the client's Pieces tab,** beneath the hair profile, read as the profile is: within the reader's places.

## Consequences

- Custom orders are raised from here next.
- Tests: `test/worker/inventory/stock-match.test.ts`, `e2e/ops/clients-visits.e2e.ts`.
