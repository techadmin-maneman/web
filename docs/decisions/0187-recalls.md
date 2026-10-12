# 0187. Recalls

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

The scope: recall in one action. Block a lot everywhere, see which kits hold it and which clients wear it; replacement tasks are created, and client messages wait for approval. Counsel's question INV-7 (recall messages on WhatsApp, whatever a client's consents, and their wording) is open.

## Decision

1. **A recall names one lot and why,** raised from the new Operations › Quality page with Operations MANAGE. A lot is recalled once; it stays blocked after its recall is closed.
2. **Blocked, by the paths stock already takes:**
   - its pieces leave the technician's piece list on the job card, as another client's custom piece does (ADR 0175);
   - every deduction, transfer and piece count takes a recalled lot last;
   - a kit hands its recalled stock back with its expired stock (ADR 0164).
     Nothing refuses a step the technician has already taken.
3. **Where it is and who wears it:** the recall lists each place holding the lot, from the lot ledger (ADR 0157), and each client wearing one of its labelled pieces.
4. **Each worn piece is made due for replacement on the recall day,** so the Tasks board's replacement orders ask for it; the day it was due before is kept in `recall_pieces`.
5. **No client is messaged from here** until counsel answers INV-7; the list says whom to contact.
6. **Closed** once its stock and pieces are dealt with.

## Consequences

- Pieces fitted before labels carry only a typed lot, and are not found by a recall; ops find them on the client's page.
- Tests: `test/worker/ops/recalls.test.ts`, `test/dom/ops-quality.test.ts`, `e2e/ops/quality.e2e.ts`.
