# 0133. The after-hours reply

- Status: accepted
- Date: 2026-10-12
- Topic: Messages and the CRM

## Context

The support scope has a message sent outside Customer Care's hours answered at once with when Care are back, and answered properly by the next morning's hour (ADR 0132). Without an answer, a client writing at night hears nothing until morning.

## Decision

1. **Our number answers a message sent while Care are off**, saying when the team is back and when they will reply, from the Care hours setting.
2. **Once a night for each chat.** A second message the same night gets no second answer; the first after the next closing does.
3. **It never counts as Care answering.** It is kept in the chat as an automatic reply, so the chat still waits on us, its reply-by time still runs, and it still becomes a task when that passes. The inbox shows the client's message as the chat's last line, not ours.
4. **Its words are on the Words page** as a message like the others. Like the answer to STOP, it is a reply in an open chat, so it is never submitted to WhatsApp as a template.
5. **A STOP gets its own answer**, not this one.

## Consequences

- It goes through the bridge today. MSG91 sends it once support phase 1 gives its provider free text, since it always falls within WhatsApp's 24-hour window.
- Tests: `test/worker/care/after-hours.test.ts`, `test/node/policy/care-hours.test.ts`.
