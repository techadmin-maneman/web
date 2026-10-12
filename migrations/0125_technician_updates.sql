-- A technician's word to the client from the job card (docs/decisions/0145-technician-presets.md): on the way, at the
-- gate, or running late, sent from our number as a message about the visit. One row each, by the phone's event ID.
CREATE TABLE technician_updates (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments (id),
  technician_id TEXT NOT NULL,
  preset TEXT NOT NULL CHECK (preset IN ('on_the_way', 'at_gate', 'running_late')),
  -- How many minutes away, or late; NULL at the gate.
  minutes INTEGER,
  -- When the phone queued it, from its event ID.
  written_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX technician_updates_by_visit ON technician_updates (appointment_id, written_at);
