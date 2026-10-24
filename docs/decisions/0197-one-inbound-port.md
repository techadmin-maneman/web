# 0197. One inbound port

- Status: accepted, on the owner's ruling of 13 October 2026
- Date: 2026-10-13
- Topic: Messages and the CRM
- Amends [0114](0114-whatsapp-business-platform-through-msg91.md)

## Context

Every sign-in and message went through Evolution, an unofficial bridge driving an ordinary WhatsApp account, and the only way in for what WhatsApp reports was Evolution's webhook: the delivery receipts that are a no-show's evidence, the STOP replies that withdraw consent, and the Care inbox. ADR 0114 built sending through MSG91's WhatsApp Business Platform, but its webhook only "when the number exists", so switching to MSG91 would have lost receipts, replies and STOP at once.

## Decision

1. **One inbound port** (`src/domain/messages/inbound.ts`): a receipt for a message we sent, or a message someone sent our number, in one shape. The port records the receipt, files the message in the Care inbox, answers out of hours, and acts on a STOP, whichever provider reported it.
2. **Each provider's hook reads its own payloads into it.** Evolution's (`/api/hooks/evolution`) as before; MSG91's (`/api/hooks/msg91`, `MSG91_WEBHOOK_TOKEN`) built to its documented webhook. Each takes its token only as `Authorization: Bearer <token>`, never in the path, which a proxy or Cloudflare's own request line would log (this replaces the path token of ADR 0041). MSG91's webhook: an outbound report delivered or read is a receipt for the message its `requestId` names, as our send answered; an inbound message's words come from `text`, or the stringified JSON of `content`, `button` (a quick reply, so a STOP button stops) or `messages`.
3. **SMS as the login codes' fallback** is built (ADR 0030): a code WhatsApp could not send goes by SMS once `SMS_PROVIDER` is `msg91`, which waits on DLT registration (provisioning, step 12b).

## Consequences

- Switching an environment to MSG91 keeps its receipts, replies and STOP: provisioning, step 12a, sets the webhook.
- The payloads are MSG91's documented ones; the first real post on the office number is checked against them (open point 186).
- Until the office number is live on MSG91, the bridge still carries every message; a dedicated hosted instance with a number of its own per environment is the owner's to provide.
- Tests: `test/worker/messages/msg91-hook.test.ts`, `test/worker/messages/evolution-hook.test.ts`.
