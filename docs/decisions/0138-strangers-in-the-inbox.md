# 0138. Chats from numbers we don't know

- Status: accepted
- Date: 2026-10-12
- Topic: Messages and the CRM

## Context

The Care inbox files every number that writes to us, matched to its client where we know the number (ADR 0129). A client writing from another phone, or someone new asking about us, arrives as a number we don't know: no name, no Care person, and no client page to act from. The support scope saves a stranger as a lead, to the CRM as leads are today, or links the chat to an existing client.

## Decision

1. **Care link the chat to the client it turns out to be**, found by name or number with the console's client search. The chat is theirs from then on, and they are given a Care person if they have none.
2. **Or Care save the person as someone new**, by the name they gave. That makes a person with the chat's number, their WhatsApp lead, and the chat theirs, with a Care person. A number one of our people already has is never saved twice: Care link the chat to them instead.
3. **A WhatsApp lead is answered in the chat, never chased.** They only wrote to us and agreed to nothing, so they are not contactable. The CRM gets the Lead_Source "WhatsApp" and the Lead_Status "WhatsApp — answer in chat". As with a try-on's delivery-only status, that status is never assigned and runs no workflows. If they later book or join the waitlist, their consent and their next lead come from that.
4. **Zoho refuses a pick-list value it does not have**, so a WhatsApp lead waits, pending and unsent, until `CRM_ORG_HAS_CARE_FIELDS` is on (ADR 0137). The sweeper leaves these leads alone until then. Once the switch is on, it sends every one waiting.
5. **leads.source gains 'whatsapp'** by swapping the column in place, as migration 0031 did. The table is never rebuilt, since tryon_jobs points at leads and D1 would refuse dropping the parent. The column keeps its name and its answers, so the running Worker is unaffected. It loses only a NOT NULL that no write relied on.
6. **Both are audited** by the chat, with the person it went to.

## Consequences

- Turning the switch on, after `scripts/ops/setup-crm.ts` and `scripts/ops/check-zoho-setup.ts`, sends the WhatsApp leads saved meanwhile.
- Tests: `test/worker/care/strangers.test.ts`, `test/worker/vendors/crm-rules.test.ts`, `test/worker/vendors/crm-sync.test.ts`, `test/worker/jobs/sweeper.test.ts`, `test/dom/ops-messages.test.ts`.
