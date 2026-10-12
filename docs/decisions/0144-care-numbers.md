# 0144. The Care numbers

- Status: accepted
- Date: 2026-10-12
- Topic: Messages and the CRM

## Context

The app promises replies the same day, and nothing measured it. The support scope adds a Care numbers page: reply times, same-day closes, the backlog, what clients write about and the remedies given, by Care person.

## Decision

1. **A Care numbers page under Customer Care**, over the last week, 30 days or 90 days.
2. **First reply is counted in Care hours.** For each chat opened in the period, the page shows the middle wait to Care's first reply, and the share answered by the chat's reply-by time (ADR 0132). An automatic reply never counts.
3. **Same day** is the share of chats closed on the India day they opened. **The backlog** is now: chats waiting on us, those overdue, and those waiting on the client.
4. **What chats were about** comes from the close reasons, and **remedies** from those given, by reason. **Each Care person** has their own chats, middle first reply and share on time.
5. **The console's Settings words now load with Settings.** Only the tab names and how a grant is phrased stay in the first load. That keeps the console's first load within its 150 KB.

## Consequences

- A chat reopened is counted from its latest opening.
- Visit ratings, check-ins and the "did we sort it?" tap join the page when they are built (support phases 6 and 2, with MSG91).
- Tests: `test/worker/care/care-numbers.test.ts`, `test/node/policy/care-hours.test.ts`, `test/dom/ops-care-numbers.test.ts`.
