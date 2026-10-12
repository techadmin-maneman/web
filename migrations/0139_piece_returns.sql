-- A piece that comes off a client (docs/decisions/0163-pieces-scanned-from-the-kit.md): held in the technician's kit as
-- returned until they hand it in, whether or not it carries one of our labels. Once for each visit and label.
CREATE TABLE piece_returns (
  id TEXT PRIMARY KEY,
  piece_code TEXT NOT NULL,
  -- The visit it came off at, and the technician whose kit holds it.
  appointment_id TEXT NOT NULL,
  technician_id TEXT NOT NULL,
  -- Why it came off, as the technician said; never the client's name.
  reason TEXT,
  returned_at TEXT NOT NULL,
  -- Where and when it was handed in; null while the kit still holds it.
  handed_in_at TEXT,
  handed_in_to TEXT,
  UNIQUE (appointment_id, piece_code)
);

CREATE INDEX piece_returns_held ON piece_returns (technician_id, returned_at) WHERE handed_in_at IS NULL;
