-- Migration number: 0203
-- A client's alerts, which every technician sees before they start, and the note a technician leaves at a visit's close
-- for whoever takes the client's next job (docs/decisions/0242-client-record.md). Both belong to the client, not a job,
-- so they survive a job given to another technician. Only new tables: the Worker already deployed reads none of them.

CREATE TABLE client_alerts (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 200),
  -- Who raised it: a member of staff, by their work e-mail, or a technician at a visit's close.
  staff TEXT,
  technician_id TEXT REFERENCES technicians (id),
  appointment_id TEXT REFERENCES appointments (id),
  written_at TEXT NOT NULL,
  taken_off_at TEXT,
  taken_off_by TEXT,
  CHECK ((staff IS NULL) <> (technician_id IS NULL)),
  CHECK ((technician_id IS NULL) = (appointment_id IS NULL)),
  CHECK ((taken_off_at IS NULL) = (taken_off_by IS NULL))
);

CREATE INDEX client_alerts_person ON client_alerts (person_id, written_at);
-- One flagged at each visit's close, however often the phone sends the close.
CREATE UNIQUE INDEX client_alerts_by_visit ON client_alerts (appointment_id) WHERE appointment_id IS NOT NULL;

CREATE TABLE handoff_notes (
  appointment_id TEXT PRIMARY KEY REFERENCES appointments (id),
  person_id TEXT NOT NULL REFERENCES people (id),
  technician_id TEXT NOT NULL REFERENCES technicians (id),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  written_at TEXT NOT NULL
);

CREATE INDEX handoff_notes_person ON handoff_notes (person_id, written_at);
