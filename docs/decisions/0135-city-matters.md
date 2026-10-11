# 0135. City matters

- Status: accepted
- Date: 2026-10-12
- Topic: Messages and the CRM

## Context

One central Customer Care team answers every chat (ADR 0129). The support scope sends what needs the client's city, such as a technician's visit or a word with the city team, to that city as a task.

## Decision

1. **Care send a matter from the chat to the client's city**, with what the city team need to know. The city is the client's, as the console places any client, from their address first. A client whose city we don't know, or a number we don't know, cannot be sent: Care add the address first.
2. **It waits on the city's Tasks as a City matter**, under Operations, for those whose grants reach the city. It is due within the day.
3. **The city closes it with what was done**, as a visit left partly done is closed: a closable task, the reason kept with the closing.
4. **Care's note and the closing reason are staff's words about the client.** Neither is in the client's export, which says only that a matter went to their city and when. Erasure blanks both, and the audit keeps only the city.

## Consequences

- The matter stays with the city it was sent to, even if the client later moves.
- Tests: `test/worker/care/city-matters.test.ts`, `test/node/policy/policy-tasks.test.ts`, `test/dom/ops-messages.test.ts`.
