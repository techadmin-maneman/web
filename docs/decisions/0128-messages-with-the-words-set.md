# 0128. Messages in the words set

- Status: accepted
- Date: 2026-10-11
- Topic: Messages and the CRM

## Context

The Words page lets Growth change the WhatsApp messages to clients (ADR 0126), held to the checks WhatsApp asks for. The scope agreed on 11 October 2026: with today's sender the new words go at once, since it sends plain text; on MSG91 each edited message needs WhatsApp's approval, and the approved wording keeps sending until then.

## Decision

1. **Each send reads the words set.** The messaging queue looks up the newest wording of the message's template, and of its stop line where it carries one, and hands it to the provider with the params (`src/queues/messaging.ts`, `messageWording` in `src/domain/words/words.ts`). None set, none is sent, and the code's wording goes.
2. **The bridge sends them at once.** Evolution renders the text from the words set, the params filled as the code's would be; the page's checks keep every param, so a message never loses a detail.
3. **MSG91 keeps its approved templates.** It sends WhatsApp-approved templates by name with their params and ignores the words set, so an edit can never reach a client unapproved. Submitting an edited message for approval, and switching once approved, waits for the office number on MSG91 (support phase 1), when it can be tried end to end.
4. **The page says which.** The Words list says whether messages send in new words at once or only once approved, and each message's form says so.

## Consequences

- The login code's message stays locked (ADR 0126), whatever the sender.
- Tests: `test/worker/messages/message-wording.test.ts`, `test/dom/ops-words.test.ts`, `e2e/ops/words.e2e.ts`.
