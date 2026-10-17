-- After a consultation, the client's yes to a fit, kept beside the reason for a no (lost_reason): 1 for yes, 0 for no,
-- NULL where the technician was not asked or the visit is no consultation. Only a new column, which the code deployed
-- neither reads nor writes.
ALTER TABLE visit_outcomes ADD COLUMN going_ahead INTEGER CHECK (going_ahead IN (0, 1));
