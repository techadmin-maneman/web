-- What booking by start time reads of a technician's days (docs/decisions/0210-booking-by-start-time.md): their own
-- week of working hours, where ops set one; their home, where the drive to their first visit starts; and leave that
-- covers part of one day. A pincode's centre stands in for a client's pin until their address has one. Only new
-- columns and a new table, which the code deployed neither reads nor writes.

-- A technician's week: a row for each day they work, with its hours. One with no rows works their city's hours every
-- day. Times are India's, "HH:MM", on the quarter hour.
CREATE TABLE technician_hours (
  technician_id TEXT NOT NULL REFERENCES technicians (id),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  starts TEXT NOT NULL CHECK (starts GLOB '[0-2][0-9]:[0-5][0-9]'),
  ends TEXT NOT NULL CHECK (ends GLOB '[0-2][0-9]:[0-5][0-9]'),
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL,
  CHECK (ends > starts),
  PRIMARY KEY (technician_id, weekday)
);

-- Where a technician's day starts: the place ops chose for them, its name as Google gave it, and its coordinate.
ALTER TABLE technicians ADD COLUMN home_label TEXT;
ALTER TABLE technicians ADD COLUMN home_place_id TEXT;
ALTER TABLE technicians ADD COLUMN home_lat REAL CHECK (home_lat IS NULL OR home_lat BETWEEN -90 AND 90);
ALTER TABLE technicians ADD COLUMN home_lng REAL CHECK (home_lng IS NULL OR home_lng BETWEEN -180 AND 180);

-- Leave over part of one day: the times it runs between, both NULL for whole days.
ALTER TABLE technician_leave ADD COLUMN from_time TEXT CHECK (from_time IS NULL OR from_time GLOB '[0-2][0-9]:[0-5][0-9]');
ALTER TABLE technician_leave ADD COLUMN to_time TEXT CHECK (to_time IS NULL OR to_time GLOB '[0-2][0-9]:[0-5][0-9]');

-- A pincode's centre, as Google places the pincode, and when it was last asked for, so one Google cannot place is not
-- asked for every hour.
ALTER TABLE serviceable_pincodes ADD COLUMN centre_lat REAL;
ALTER TABLE serviceable_pincodes ADD COLUMN centre_lng REAL;
ALTER TABLE serviceable_pincodes ADD COLUMN centre_asked_at TEXT;
