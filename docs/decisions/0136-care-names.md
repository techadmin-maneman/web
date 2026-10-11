# 0136. The name a client knows their Care person by

- Status: accepted
- Date: 2026-10-12
- Topic: Messages and the CRM

## Context

Each client has a named Care person (ADR 0131). Staff are known in the system by e-mail, which no client should see, so the app could not name them.

## Decision

1. **A Customer Care manager sets the first name each Care member is known by to clients**, from the Care team panel. It is a name for clients, not a staff record: the Staff list is unchanged.
2. **The app's Support card says "Your Care person is Asha."** It shows that once the client has a Care person with a name, and nothing about it before.
3. **Each name set is audited** against the member's e-mail.

## Consequences

- A member without a name is still everyone's Care person in the console; clients just aren't told who.
- Tests: `test/worker/app/client-profile.test.ts`, `test/worker/care/cover.test.ts`, `test/dom/app-support-card.test.ts`, `test/dom/ops-messages.test.ts`.
