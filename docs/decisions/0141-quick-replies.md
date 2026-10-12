# 0141. Quick replies

- Status: accepted
- Date: 2026-10-12
- Topic: Messages and the CRM

## Context

The support scope gives Customer Care saved answers to the questions clients ask most, kept by a Customer Care manager so every Care person answers the same way.

## Decision

1. **A quick reply is a title and a text**, in `quick_replies`. A Customer Care manager adds and retires them; anyone in Care reads them, by title. A retired reply is kept, as the record of what was offered.
2. **In a chat, Care pick one and it goes into the reply box filled in**: `{name}` as the client's first name, `{next_visit}` as their next visit. Care can change it before sending.
3. **Each add and retire is audited.**

## Consequences

- Tests: `test/worker/care/quick-replies.test.ts`.
