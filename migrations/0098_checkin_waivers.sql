-- Migration number: 0098
-- Ops letting a technician check in to one visit wherever the geofence puts him: a building pin far from the door, say.
-- Who did, when and why are kept on the visit; a check-in that passed only by it names them, as the no-show's
-- evidence shows (src/domain/check-ins.ts).
--
-- Expand only: new columns, empty. The Worker already deployed names none of them.

ALTER TABLE appointments ADD COLUMN checkin_waived_at TEXT;
ALTER TABLE appointments ADD COLUMN checkin_waived_by TEXT;
ALTER TABLE appointments ADD COLUMN checkin_waived_reason TEXT;
ALTER TABLE checkins ADD COLUMN waived_by TEXT;
