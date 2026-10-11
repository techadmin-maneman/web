# 0138. Chats from numbers we don't know

- Status: accepted
- Date: 2026-10-12
- Topic: Messages and the CRM

## Context

The Care inbox files every number that writes to us, matched to its client where we know the number (ADR 0129). A client writing from another phone, or someone new asking about us, arrives as a number we don't know: no name, no Care person, and no client page to act from.

## Decision

1. **Care link the chat to the client it turns out to be**, found by name or number with the console's client search. The chat is theirs from then on, and they are given a Care person if they have none.
2. **Or Care save the person as someone new**, by the name they gave. That makes a person with the chat's number, not contactable, and the chat theirs, with a Care person. A number one of our people already has is never saved twice: Care link the chat to them instead.
3. **Someone saved this way is no CRM lead yet.** A lead would be chased by the CRM's workflows, and whether we may follow up someone who only wrote to us is a question for counsel, with the support scope's other consent questions. If they book or join the waitlist, their lead is written then, under the person already saved.
4. **Both are audited** by the chat, with the person it went to.

## Consequences

- When counsel answers, a WhatsApp lead source and its CRM status follow in a change of their own. They would go behind the switch for the org's Care fields (ADR 0137).
- Tests: `test/worker/care/strangers.test.ts`, `test/dom/ops-messages.test.ts`.
