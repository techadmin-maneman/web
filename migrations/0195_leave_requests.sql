-- Migration number: 0195
-- A technician's ask for leave from their phone, which Operations approve or decline on Tasks
-- (src/domain/dispatch/leave-requests.ts). An approval records the leave as ops record it themselves, which the
-- request then names. Only a new table: the Worker already deployed writes and reads nothing of it.

CREATE TABLE leave_requests (
  id TEXT PRIMARY KEY,
  technician_id TEXT NOT NULL REFERENCES technicians (id),
  -- Inclusive, both of them, as technician_leave's.
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  -- Why, in the technician's words; never a medical detail asked for.
  note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 300),
  requested_at TEXT NOT NULL,
  decision TEXT CHECK (decision IN ('approved', 'declined')),
  -- The Access identity of whoever decided, and when.
  decided_by TEXT,
  decided_at TEXT,
  -- The leave an approval recorded.
  leave_id TEXT REFERENCES technician_leave (id),
  CHECK (to_date >= from_date),
  CHECK ((decision IS NULL) = (decided_at IS NULL))
);

CREATE INDEX leave_requests_by_technician ON leave_requests (technician_id, requested_at);
CREATE INDEX leave_requests_open ON leave_requests (requested_at) WHERE decision IS NULL;
