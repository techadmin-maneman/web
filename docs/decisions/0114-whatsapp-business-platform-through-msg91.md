# 0114. The WhatsApp Business Platform through MSG91

- Status: accepted
- Date: 2026-10-11
- Topic: Messages and the CRM
- Amends [0016](0016-whatsapp-through-evolution.md): Evolution stays the sender until the business number is ready

## Context

Every login code, reminder and try-on look goes through Evolution, which drives an ordinary WhatsApp account through WhatsApp Web (ADR 0016). That breaks WhatsApp's terms, and a ban would stop every sign-in and message at once. The official route is the WhatsApp Business Platform, through a provider, with templates WhatsApp approves. MSG91 passes WhatsApp's own per-message rates through and adds a monthly fee; it also sends DLT SMS, should codes ever need a fallback.

The business does not yet have the office WhatsApp Business number the platform needs.

## Decision

1. **MSG91 is built now and switched off.** `MESSAGING_PROVIDER` takes `msg91` beside `evolution` and `stub`; each environment keeps `evolution` until its number and templates are ready.
2. **Our texts stay the one source.** `src/config/approved-templates.ts` derives each template's approved form from `src/config/message-templates.ts`: variables renumbered in the order they appear, a closing link turned into a button, and the stop line, which the bridge appends, as a button on the reminders. `node scripts/ops/whatsapp-templates.ts` prints them as they are submitted.
3. **A login code is an authentication template,** in WhatsApp's own words, with a copy-code button.
4. **Switching over is a change of one var,** once the templates are approved (`docs/provisioning.md`, "WhatsApp through MSG91").

## Consequences

- Delivery receipts and STOP replies still come from Evolution's webhook. MSG91's own webhook is built when the number exists and its payloads can be read (`docs/open-points.md`).
- A new or changed text needs approving again before MSG91 can send it; the bridge sends it at once.
