-- Migration number: 0101
-- What the phone said each technician's write happened at, before the server held it within bounds
-- (src/policy/phone-clock.ts): ops see where the two differ. Null where the phone said nothing, and for older events.
-- Expand only: a new column. The Worker already deployed writes none of it.

ALTER TABLE job_events ADD COLUMN claimed_at TEXT;
