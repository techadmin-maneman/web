-- Whose a visit is, fixed the evening before (docs/decisions/0290-allotted-the-evening-before.md): until then its
-- technician is a draft the booking engine may change, which neither the client nor the technician is shown. A visit
-- booked from now on is a draft until its day's lock at the reminder hour of the evening before, or at once where that
-- has passed; every visit already booked keeps its technician, so the column starts at 0 with nothing to backfill.
ALTER TABLE appointments ADD COLUMN technician_draft INTEGER NOT NULL DEFAULT 0 CHECK (technician_draft IN (0, 1));

-- The lock and the re-plan read only the drafts, which are few and soon fixed.
CREATE INDEX appointments_drafts ON appointments (window_start) WHERE technician_draft = 1;
