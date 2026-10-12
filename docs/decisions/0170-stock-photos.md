# 0170. Photographs of stock

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

The owner ruled on 11 October 2026 that a returned piece outside warranty is written off with a reason and a photograph (ADR 0169). A claim on a supplier is stronger with one too.

## Decision

1. **A photograph of stock is stored by itself first,** `POST /api/stock-photos` with Operations ACT: a JPEG or PNG of at most 2 MB, which the console makes about 250 KB as the technician's camera does (`@maneman/web-kit/small-jpeg`). It answers the photograph's ID.
2. **It is kept in the client-photos bucket under `stock/`,** counted by the storage meter like every other photograph (ADR 0093), and refused past the runaway ceiling. It names no client.
3. **A write-off of a returned piece must name one;** a claim may name one when it is sent. Each write checks the photograph was stored.
4. **It is read back** with Operations VIEW, never cached.

## Consequences

- A photograph stored and never named by a write stays in the bucket; ops' uploads are few and small.
- Tests: `test/worker/ops/supplier-claims.test.ts`, `e2e/ops/supplier-claims.e2e.ts`.
