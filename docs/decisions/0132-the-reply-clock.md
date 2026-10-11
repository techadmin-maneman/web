# 0132. The reply clock

- Status: accepted
- Date: 2026-10-12
- Topic: Messages and the CRM

## Context

The support scope sets Customer Care's hours at 9 am to 9 pm every day, a first reply within the hour, and a message sent after hours answered by 10 am, all as console settings. The inbox (ADR 0129) listed the chats waiting on us, with no sense of when each was due.

## Decision

1. **One setting, Customer Care hours**: when Care open and close, the first-reply minutes, and the after-hours answered-by hour. The hours are the same every day, public holidays too. A figure that contradicts another, such as closing before opening, is refused.
2. **Each chat waiting on us has a reply-by time**, counted from the client's last unanswered message. A message sent in hours is due within the first-reply minutes, unless that would fall after closing. A message sent after hours, or one whose minutes would run past closing, is due by the answered-by hour the next morning.
3. **The inbox shows the reply-by time** in place of how long the chat has waited, and marks it overdue once it has passed.

## Consequences

- An overdue chat becomes a Customer Care task next, and the after-hours auto-reply quotes the same hours. Both read this setting.
- Tests: `test/node/policy/care-hours.test.ts`, `test/worker/care/inbox.test.ts`, `test/dom/ops-messages.test.ts`.
