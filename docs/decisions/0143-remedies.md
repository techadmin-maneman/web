# 0143. Remedies

- Status: accepted
- Date: 2026-10-12
- Topic: Messages and the CRM

## Context

The support scope lets Customer Care put things right on the spot: service-visit credits, or a free re-fit booked with one, up to a limit set in the console, with a manager approving anything above it. Each remedy has a reason and a note, and refunds stay with Finance.

## Decision

1. **A remedy is free service visits**, given from the client's chat with a reason (fit problem, technician late, visit missed by us, product fault, other) and a note for the team. A free re-fit is then booked with one of them, as any visit a credit pays for.
2. **Within the limit ops set, it is given at once.** The limit is a setting, Remedies without approval: free visits per client over a number of days, by default one in 90. A given remedy is a grant in the credit ledger, under its own ID.
3. **Above the limit it awaits a Customer Care manager**, as a Remedy to approve on Tasks and in the Remedies panel on the Messages page. Approving grants the visits and leaves a note in the client's chat, so their Care person tells them. Declining grants nothing.
4. **Each step is audited with the number of visits**, never with the note. The client's export lists their remedies and why, without Care's note, and erasure blanks the note.

## Consequences

- The Care numbers page counts remedies by reason, city and technician when it is built.
- A goodwill visit's tax treatment is the CA's question, with the other free visits.
- Tests: `test/worker/care/remedies.test.ts`, `test/node/policy/remedies.test.ts`, `test/dom/ops-messages.test.ts`.
