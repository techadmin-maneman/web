-- Migration number: 0204
-- A step of a visit that ops sent back to its technician, with why (docs/decisions/0246-closed-and-sent-back.md): the
-- phone opens the step again, it may land after the visit has closed until it does, and landing it again clears it.
-- Only a new table: the Worker already deployed reads none of it.

CREATE TABLE step_send_backs (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments (id),
  kind TEXT NOT NULL CHECK (kind IN ('before_photos', 'checklist', 'consumables', 'after_photos')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 300),
  -- The member of staff who sent it back, by their work e-mail; never shown on a phone.
  sent_by TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  -- When the step landed again, which clears it.
  cleared_at TEXT
);

-- One open at a time for each step of a visit.
CREATE UNIQUE INDEX step_send_backs_open ON step_send_backs (appointment_id, kind) WHERE cleared_at IS NULL;
CREATE INDEX step_send_backs_visit ON step_send_backs (appointment_id, sent_at);
