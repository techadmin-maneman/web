# 0134. Days off and cover for the Care team

- Status: accepted
- Date: 2026-10-12
- Topic: Messages and the CRM

## Context

Each client has a named Care person (ADR 0131), and the support scope has someone cover their chats when they are off. Care hours are the team's (ADR 0132); each member also has days off.

## Decision

1. **A member is off on their weekly days off and on leave.** A Customer Care manager sets both from the Care team panel on the Messages page. Leave runs from one date to another, both included, and is taken back by deleting it.
2. **On a day a Care person is off, the member on with the fewest clients covers them.** Each cover takes on the clients of whoever they cover before the next is placed, so two people off go to two people where the team allows. Cover is worked out for the day as it is read, never stored, so a change to the days off takes effect at once.
3. **The cover answers for them that day.** The covered clients' chats are in the cover's My clients, and the inbox shows "covered by" beside the Care person. The client keeps their Care person.
4. **Each change is audited** against the member's e-mail: days off with the weekdays, leave with its dates.

## Consequences

- Nobody covers while the whole team is off, and the chats wait for the reply clock and the Unanswered chat task as before.
- The tables hold staff e-mails, not clients, so the export and erasure do not touch them.
- Tests: `test/node/policy/care-cover.test.ts`, `test/worker/care/cover.test.ts`, `test/dom/ops-messages.test.ts`.
