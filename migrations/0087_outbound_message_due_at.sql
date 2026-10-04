-- Migration number: 0087
-- When a message held back on the queue is due to leave. A launch's alerts leave in a paced line
-- (src/policy/message-pacing.ts), each held back until its turn, and the sweeper sends one again only once it is
-- overdue (src/scheduled/unsent-messages.ts). Null for a message sent at once, which is due when it is queued.
--
-- Expand only: a new column, empty. The Worker already deployed names none of it.

ALTER TABLE outbound_messages ADD COLUMN due_at TEXT;
