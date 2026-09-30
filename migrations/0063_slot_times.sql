-- Migration number: 0063
-- The times of a working day's half-slots, which ops set in the console, each change from a day nothing is booked or
-- bookable on (docs/decisions/0102-window-times.md; src/policy/slot-times.ts). A new table, empty: until ops set a
-- change, every day keeps the times in code, and the Worker already deployed reads nothing of it.

-- One change of times: the day it applies from, and the eight half-slot starts and the day's end in India's time. A
-- day takes the change with the latest applies_from on or before it. Changes are only ever added, never edited or
-- deleted, since a visit may be booked by the times of any change already in force.
CREATE TABLE slot_times (
  id TEXT PRIMARY KEY,
  applies_from TEXT NOT NULL UNIQUE,
  -- A JSON array of eight "HH:MM", in order.
  unit_starts TEXT NOT NULL,
  day_end TEXT NOT NULL,
  -- The member of staff's Access e-mail, and when they set it.
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL
);

CREATE TRIGGER slot_times_no_update
BEFORE UPDATE ON slot_times
BEGIN
  SELECT RAISE(ABORT, 'slot_times are append-only');
END;

CREATE TRIGGER slot_times_no_delete
BEFORE DELETE ON slot_times
BEGIN
  SELECT RAISE(ABORT, 'slot_times are append-only');
END;
