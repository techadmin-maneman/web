-- Migration number: 0102
-- The session a client asked for a change of number from. Ops' confirmation signs every other session of theirs
-- out, so a phone that went with the old number stays signed in no longer. Null for requests made before this.
-- Expand only: a new column. The Worker already deployed writes none of it.

ALTER TABLE number_change_requests ADD COLUMN session_id TEXT;
