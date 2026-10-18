-- The start a hold keeps (docs/decisions/0210-booking-by-start-time.md), in place of the window's half-slot, and the
-- claims by their day, which booking reads every technician's lock on. Only a new column and an index; the code
-- deployed neither reads nor writes the column.
ALTER TABLE slot_holds ADD COLUMN starts_at TEXT;
CREATE INDEX slot_claims_by_date ON slot_claims (date);
