# 0142. Moving every client, and technicians in the inbox

- Status: accepted
- Date: 2026-10-12
- Topic: Messages and the CRM

## Context

The support scope lets a Customer Care manager move clients one at a time (ADR 0131) or all at once, for example when someone leaves. It also labels a technician who writes to the office number as a technician, for Operations.

## Decision

1. **A manager moves every client of one member to another on the team** from the Care team panel. The move is audited once, with how many clients went.
2. **Someone no longer on the team who still has clients stays listed**, marked as no longer on the team, until their clients are moved. Leaving the team moves nobody by itself.
3. **A chat from a number on a technician's record is labelled as that technician**, in the list and the chat, with a link to their page and a note that Operations answer technicians. It is never offered to be linked or saved as a client.

## Consequences

- Each client moved keeps their history; only who looks after them changes.
- Tests: `test/worker/care/cover.test.ts`, `test/dom/ops-messages.test.ts`.
