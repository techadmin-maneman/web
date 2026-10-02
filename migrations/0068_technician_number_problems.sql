-- Migration number: 0068
-- A technician whose number keeps him from signing in is kept out of new bookings (src/policy/technician-numbers.ts):
-- 'unreadable' where FSM holds no mobile the mirror can read for him, 'shared' where another active technician signs
-- in on his number. Empty while his number is his own. The technician sync writes it.
--
-- Expand only: the Worker already deployed reads nothing of it, and every row starts empty, so nobody is kept out
-- until the next sync.

ALTER TABLE technicians ADD COLUMN number_problem TEXT CHECK (number_problem IN ('unreadable', 'shared'));
