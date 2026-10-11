# 0137. A client's last contact in the CRM

- Status: accepted
- Date: 2026-10-12
- Topic: Messages and the CRM

## Context

Chats and calls live in the console only (ADR 0129); the support scope gives the CRM the client's last-contact date and reason, so the sales side sees when Care last spoke to someone and what about, without the conversation itself.

## Decision

1. **Closing a chat updates the client's CRM lead**, through the same queue that sends a new number or address. The consumer reads the person afresh.
2. **Two fields: Last_Contact_Date**, India's date of the last closed chat, **and Last_Contact_Reason**, what it was about, from the reasons Care close a chat with. The words of the chat never leave the console.
3. **Zoho refuses a pick-list value it does not have, so nothing is written until the org has the fields.** `scripts/ops/setup-crm.ts` creates them and `scripts/ops/check-zoho-setup.ts` proves them. `CRM_ORG_HAS_CARE_FIELDS` in `src/config/crm.ts` is then turned on in a release, as the referral fields were.

## Consequences

- Until the switch is on, closing a chat still sends the number and city again, which change nothing.
- A number we don't know has no CRM lead and sends nothing.
- Tests: `test/worker/vendors/crm-sync-queue.test.ts`, `test/worker/vendors/zoho-tokens-erasure.test.ts`, `test/worker/care/replies.test.ts`, `test/node/api/last-contact-reasons.test.ts`.
