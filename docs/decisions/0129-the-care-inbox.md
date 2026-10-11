# 0129. The Care inbox

- Status: accepted
- Date: 2026-10-12
- Topic: Messages and the CRM

## Context

The customer support scope the owner approved on 11 October 2026 puts every chat with a client in a console inbox, beside their record, answered by one central Care team. Its first phase moves our number to MSG91, which waits on a new office number and 30 days of its chats. Until then the WhatsApp bridge already receives what clients write to us, and read only their STOP replies.

## Decision

1. **One thread a number.** `conversations` keeps a thread for each number that writes to us, matched to its client where we know the number; a number we don't know keeps a thread of its own. `chat_messages` keeps every message in it: the client's, our replies, and notes only staff see. A message reported twice is filed once, by WhatsApp's ID for it.
2. **The bridge files what clients write, now.** Every message to our number lands in its thread, STOP replies included, which still stop our messages. A client who writes reopens a closed thread. MSG91's incoming messages will file into the same tables (support phase 1).
3. **Our automatic messages sit in the thread** without being copied: a thread reads them from `outbound_messages`, with how far each got.
4. **Customer Care · Messages** lists the threads a view at a time (waiting on us, waiting on the client, closed, all), each opened beneath its row. National Customer Care · View reads it.
5. **Chats are part of the client's record.** Their export gives their chats, never staff's notes; their erasure blanks every message's words and makes the thread's number nobody's.

## Consequences

- Replies, notes, closing with a reason, Care people and the reply clock follow in the next pull requests of phases 2 and 3.
- Tests: `test/worker/care/inbox.test.ts`, `test/dom/ops-messages.test.ts`, `e2e/ops/messages.e2e.ts`.
