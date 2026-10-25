-- Migration number: 0193
-- Staff's short notes on a client, shown at the top of their page in the console: "prefers mornings", "sensitive
-- scalp" (src/domain/clients/staff-notes.ts). A change is a new note that replaces the one before, and a note taken
-- off is marked so, never deleted, so what was written, by whom and when stays. Only a new table: the Worker already
-- deployed writes and reads nothing of it.

CREATE TABLE staff_notes (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  -- The member of staff's work e-mail.
  written_by TEXT NOT NULL,
  written_at TEXT NOT NULL,
  -- The note this one changed, which is taken off as it is written.
  replaces TEXT REFERENCES staff_notes (id),
  taken_off_at TEXT,
  taken_off_by TEXT,
  CHECK ((taken_off_at IS NULL) = (taken_off_by IS NULL))
);

CREATE INDEX staff_notes_person ON staff_notes (person_id, written_at);
-- What an erasure's delete looks up, the notes that replaced the ones it deletes.
CREATE INDEX staff_notes_replaces ON staff_notes (replaces);
