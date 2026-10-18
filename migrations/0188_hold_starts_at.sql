-- The start a hold keeps (docs/decisions/0210-booking-by-start-time.md): the instant its visit starts, which booking
-- by start time chose, in place of the window's half-slot. Only a new column; the code deployed neither reads nor
-- writes it, and keeps the window and half-slot it reads beside it.
ALTER TABLE slot_holds ADD COLUMN starts_at TEXT;
