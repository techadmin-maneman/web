-- Migration number: 0205
-- When a technician who left a visit partly done, or could not fit, suggests finishing it: tomorrow morning, tomorrow
-- evening, or ops to call the client (docs/decisions/0246-closed-and-sent-back.md). Ops read it on the visit's task.
-- Only new columns, which the code deployed neither reads nor writes.
ALTER TABLE visit_outcomes ADD COLUMN finish_ask TEXT CHECK (finish_ask IN ('tomorrow_morning', 'tomorrow_evening', 'ops_call'));
ALTER TABLE visit_outcomes ADD COLUMN finish_asked_at TEXT;
