-- Migration number: 0105
-- A move to another day that ops ask the client to confirm, held until they accept it, withdrawn, or made moot by
-- a move since (docs/decisions/0115-a-move-to-another-day-waits-for-the-client.md). One is open on a visit at a time.
-- Expand only: the Worker already deployed names none of it.

CREATE TABLE move_proposals (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments (id),
  -- Where the visit would go.
  technician_id TEXT NOT NULL REFERENCES technicians (id),
  date TEXT NOT NULL,
  window_label TEXT NOT NULL CHECK (window_label IN ('morning', 'afternoon', 'evening')),
  reason TEXT NOT NULL,
  -- The Access identity that asked, which the move names once accepted.
  proposed_by TEXT NOT NULL,
  -- The visit as the board showed it when ops asked: a move since makes the proposal moot.
  expected_technician_id TEXT,
  expected_start TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- The last moment it may be accepted: two days on, or the visit's own start if that is sooner.
  expires_at TEXT NOT NULL,
  answered_at TEXT,
  answer TEXT CHECK (answer IN ('accepted', 'withdrawn', 'moot')),
  move_id TEXT REFERENCES dispatch_moves (id),
  message_id TEXT,
  CHECK ((answered_at IS NULL) = (answer IS NULL)),
  CHECK (answer IS NOT 'accepted' OR move_id IS NOT NULL)
);

CREATE UNIQUE INDEX move_proposals_open ON move_proposals (appointment_id) WHERE answered_at IS NULL;
