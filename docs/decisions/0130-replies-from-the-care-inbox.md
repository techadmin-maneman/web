# 0130. Replies from the Care inbox

- Status: accepted
- Date: 2026-10-12
- Topic: Messages and the CRM

## Context

The Care inbox files what clients write to our number (ADR 0129). The support scope has Care answer there, from the office number, rather than from anyone's own WhatsApp, with notes only staff see and each chat closed with what it was about.

## Decision

1. **A reply goes from our number.** Care write it in the chat; the messaging provider sends it as free text (`reply`), and it is kept in the thread whether it went or not, a refusal with WhatsApp's reason. A sent reply leaves the chat waiting on the client.
2. **The bridge sends replies today.** It sends plain text at any time. MSG91 sends free text only inside WhatsApp's 24-hour window, which support phase 1 brings with the office number; until then the console says replies wait for it, and nothing is sent.
3. **Notes are for staff alone**, kept in the thread and never sent.
4. **Closing names what the chat was about**: booking, move or cancel, fit problem, aftercare, billing, signing in, try-on, their data, or other. A client who writes again reopens it.
5. **Customer Care · Act replies, notes and closes.** Each is audited by the thread's ID; the audit never keeps the words.

## Consequences

- An erased client's thread takes no reply: its number is nobody's.
- The reasons become a console setting with the rest of the support settings (phase 3); the 24-hour window and replies outside it come with MSG91 (phase 1).
- Tests: `test/worker/care/replies.test.ts`, `test/dom/ops-messages.test.ts`.
