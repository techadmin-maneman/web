-- Migration number: 0207
-- contract: docs/decisions/0248-safety.md
-- A technician's safety on a visit (docs/decisions/0248-safety.md): where they are from check-in to the close, the
-- latest alone, and their SOS until ops mark it handled. New tables, and a trigger whose DELETE touches only the new
-- visit_positions: the Worker already deployed reads and writes none of it.

CREATE TABLE visit_positions (
  appointment_id TEXT PRIMARY KEY REFERENCES appointments (id),
  technician_id TEXT NOT NULL REFERENCES technicians (id),
  lat REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy_m REAL CHECK (accuracy_m >= 0),
  -- When the phone read it, and when it reached us.
  at TEXT NOT NULL,
  received_at TEXT NOT NULL
);

-- The sweep's read: positions older than it keeps any.
CREATE INDEX visit_positions_received ON visit_positions (received_at);

-- Gone once the visit closes, is called off, is given to another technician, is moved to another time (its check-in set
-- aside) or is deleted: none of these needs a position.
CREATE TRIGGER visit_positions_end AFTER UPDATE OF status, technician_id, window_start, deleted_at ON appointments
WHEN NEW.status IN ('completed', 'terminated', 'cancelled')
  OR NEW.technician_id IS NOT OLD.technician_id
  OR NEW.window_start IS NOT OLD.window_start
  OR NEW.deleted_at IS NOT NULL
BEGIN
  DELETE FROM visit_positions WHERE appointment_id = NEW.id;
END;

CREATE TABLE sos_alerts (
  id TEXT PRIMARY KEY,
  technician_id TEXT NOT NULL REFERENCES technicians (id),
  -- The visit they were on, where there was one.
  appointment_id TEXT REFERENCES appointments (id),
  -- Where they were, last heard while it is open; blanked once it is handled.
  lat REAL CHECK (lat BETWEEN -90 AND 90),
  lng REAL CHECK (lng BETWEEN -180 AND 180),
  accuracy_m REAL CHECK (accuracy_m >= 0),
  position_at TEXT,
  sent_at TEXT NOT NULL,
  -- The technician said they are safe.
  safe_at TEXT,
  -- Ops marked it handled, by their work e-mail.
  handled_at TEXT,
  handled_by TEXT
);

-- Whether a technician ever sent one, which keeps them from being deleted.
CREATE INDEX sos_alerts_technician ON sos_alerts (technician_id);
-- One open at a time for each technician: a second SOS is the first, its position brought up to date.
CREATE UNIQUE INDEX sos_alerts_open ON sos_alerts (technician_id) WHERE handled_at IS NULL;
-- The console's banner: the SOS still open, oldest first.
CREATE INDEX sos_alerts_open_sent ON sos_alerts (sent_at) WHERE handled_at IS NULL;
