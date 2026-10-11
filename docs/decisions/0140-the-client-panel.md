# 0140. The client beside their chat

- Status: accepted
- Date: 2026-10-12
- Topic: Messages and the CRM

## Context

The support scope puts the client panel beside each chat, with one-tap actions from screens that already exist: book a visit, move one, send a payment link. Care should answer without hunting for the client's page.

## Decision

1. **A chat with a known client shows the client beside it**: their next and last visit, their free service visits, and their city. It reads the client record the client's page reads, so nothing new is kept.
2. **The actions are links into the client's page**: Visits to book or move, Payments to send a link, Hair system, and Consents. Each screen already does its job, with its own checks and wording.
3. **An erased client, or a number we don't know, shows no panel.**

## Consequences

- Giving a remedy and calling the client join the links when those are built.
- Tests: `test/dom/ops-messages.test.ts`.
