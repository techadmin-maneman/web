# 0158. Transfers in transit

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

Stock moved between the warehouse, a hub and a stockroom travels for days, and some of it can be lost or damaged on the way. A transfer that lands at both ends at once (ADR 0087) shows the other end holding stock it has not yet seen, and hides what went missing.

## Decision

1. **Stock sent to a warehouse, a hub or a stockroom is in transit** (`stock_transfers`): it leaves its place when sent, of the lots that expire soonest (ADR 0157), and arrives only when the other end receives it.
2. **Received in full or short.** The place it went to records what arrived, all of it by default, with a word on what was lost; the shortfall leaves the ledger with the transfer, never arriving anywhere. It arrives of the lots that left, soonest to expire first.
3. **Sent back** before it arrives, by the place it left: all of it returns there, of the same lots.
4. **Settled once.** The first statement of a receipt or a send-back settles the transfer under its own token, and every row after it is written only where that token stands, so two people settling one transfer at once settle it once; the other is told it was settled (`transfer_settled`).
5. **Stock handed to a kit arrives at once**, as every transfer did before: a technician takes it in person.
6. **Reach:** a transfer shows to anyone whose cities take in either end; receiving needs the place it went to, sending back the place it left.
7. **The Stock page** lists what is in transit, with Receive and Send back, loaded only while something is on its way.

## Consequences

- The ledger holds what each place has; in transit is the transfers not yet settled. An alert for a transfer long on its way comes with the expiry view's alerts.
- Tests: `test/worker/inventory/stock-transit.test.ts`, `e2e/ops/stock.e2e.ts`.
