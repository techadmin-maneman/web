-- Migration number: 0059
-- A no-show's charge and its dispute, and the free change a visit ops moved keeps
-- (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md; the plan's pieces C3 and C10, open points 60 and 71).
--
-- New nullable columns and a new table: the Worker already deployed reads none of them, and a no-show it charges,
-- or a move it makes, reads here as one ruled or moved before, as the code that ships with this migration expects.

-- What a charged no-show cost the client, as the booking was sold under it (ADR 0088): the charge, what it kept of
-- the visit's payment, and what it gave back, in paise. NULL on a waiver, and on a case charged before this, which
-- kept whatever the visit took and recorded no amount.
ALTER TABLE no_show_cases ADD COLUMN charge TEXT CHECK (charge IN ('nothing', 'late_fee', 'visit'));
ALTER TABLE no_show_cases ADD COLUMN kept_amount INTEGER;
ALTER TABLE no_show_cases ADD COLUMN refund_amount INTEGER;

-- A client's dispute of a no-show's charge, from the app, and ops' ruling on it: refunded or upheld, with ops'
-- reason. One a charge: a case is ruled once, and its charge disputed once.
CREATE TABLE no_show_disputes (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE REFERENCES no_show_cases (id),
  person_id TEXT NOT NULL REFERENCES people (id),
  -- The client's own words; NULL once they are erased.
  reason TEXT,
  created_at TEXT NOT NULL,
  ruling TEXT CHECK (ruling IN ('refunded', 'upheld')),
  ruled_by TEXT,
  ruled_at TEXT,
  -- Ops' own words about the client, which reach no message; NULL once the client is erased.
  ruling_reason TEXT
);

-- The disputes ops have still to rule on, oldest first, however many have been ruled; and a client's, which their
-- erasure blanks and their export reads.
CREATE INDEX no_show_disputes_open ON no_show_disputes (created_at) WHERE ruling IS NULL;
CREATE INDEX no_show_disputes_by_person ON no_show_disputes (person_id);

-- When the visit started before ops moved it: the time the client last chose, kept through every move ops make
-- after it and cleared by the client's own. A client's change counts its notice from it where it is later than the
-- visit's time, so a move by ops never takes a free change away. NULL while the visit is where its booking, or the
-- client's last move, put it.
ALTER TABLE appointments ADD COLUMN start_before_move TEXT;
