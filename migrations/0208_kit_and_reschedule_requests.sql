-- Migration number: 0208
-- A technician's asks of ops from the phone (docs/decisions/0249-schedule-kit-and-me.md): what the kit is short of for
-- the next seven days, and a visit to move, with why. Each is a task on the board until ops close it, which settles it;
-- a visit moved, given to another technician, closed or called off settles its own. New tables and a trigger that
-- updates only them: the Worker already deployed reads and writes none of it.

CREATE TABLE kit_requests (
  id TEXT PRIMARY KEY,
  technician_id TEXT NOT NULL REFERENCES technicians (id),
  -- What the kit was short of when asked: [{ "code", "quantity" }], by the job sheet's counts.
  items TEXT NOT NULL CHECK (json_valid(items) AND json_type(items) = 'array'),
  requested_at TEXT NOT NULL,
  settled_at TEXT
);

-- One ask open a kit at a time, which the phone shows until ops settle it.
CREATE UNIQUE INDEX kit_requests_open ON kit_requests (technician_id) WHERE settled_at IS NULL;

CREATE TABLE reschedule_requests (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments (id),
  technician_id TEXT NOT NULL REFERENCES technicians (id),
  reason TEXT NOT NULL CHECK (reason IN ('client_asked', 'running_late', 'kit_problem')),
  requested_at TEXT NOT NULL,
  settled_at TEXT
);

-- One ask open a visit at a time, which its card shows until it is settled.
CREATE UNIQUE INDEX reschedule_requests_open ON reschedule_requests (appointment_id) WHERE settled_at IS NULL;

CREATE TRIGGER reschedule_requests_settled AFTER UPDATE OF status, technician_id, window_start, deleted_at ON appointments
WHEN NEW.status IN ('completed', 'terminated', 'cancelled')
  OR NEW.technician_id IS NOT OLD.technician_id
  OR NEW.window_start IS NOT OLD.window_start
  OR NEW.deleted_at IS NOT NULL
BEGIN
  UPDATE reschedule_requests SET settled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE appointment_id = NEW.id AND settled_at IS NULL;
END;
