-- Migration number: 0209
-- A technician's alerts (docs/decisions/0250-guides-and-alerts.md): the inbox the phone reads, newest first, which a
-- push with no payload tells it of; the phone that takes the pushes; and the kinds the technician turned off. A job in
-- the coming week moved, called off or given to another technician writes its alert by a trigger, whatever made the
-- change. New tables, and triggers that write only them: the Worker already deployed reads and writes none of it.

CREATE TABLE tech_alerts (
  id TEXT PRIMARY KEY,
  technician_id TEXT NOT NULL REFERENCES technicians (id),
  kind TEXT NOT NULL CHECK (
    kind IN ('time_to_leave', 'day_ahead', 'job_moved', 'job_cancelled', 'job_reassigned', 'running_over')
  ),
  -- The job it is about: for the day ahead, the day's first.
  appointment_id TEXT REFERENCES appointments (id),
  -- India's date the alert is for: the job's day, or the day ahead's.
  date TEXT NOT NULL,
  -- The job's start, or the day ahead's first; and a moved job's start before the move.
  starts_at TEXT,
  was_starts_at TEXT,
  -- Time to leave: when to set off, and the drive.
  leave_by TEXT,
  drive_minutes INTEGER,
  -- Running over: when the job under way must be done to reach this one on time.
  finish_by TEXT,
  -- The day ahead: how many jobs it holds.
  jobs INTEGER,
  -- One alert of a kind for a job, a day, or a move to a time.
  once_key TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  -- When the push went; NULL while it is to go.
  pushed_at TEXT,
  read_at TEXT,
  UNIQUE (technician_id, once_key)
);

CREATE INDEX tech_alerts_inbox ON tech_alerts (technician_id, sent_at);
CREATE INDEX tech_alerts_by_time ON tech_alerts (sent_at);

-- The phone that takes the technician's pushes, one subscription a phone, by the push service's own address. A phone
-- revoked or signed out takes none.
CREATE TABLE push_subscriptions (
  device_id TEXT PRIMARY KEY REFERENCES technician_devices (id),
  endpoint TEXT NOT NULL UNIQUE,
  subscribed_at TEXT NOT NULL
);

-- The kinds of alert a technician turned off; every kind is on until then.
CREATE TABLE tech_alert_kinds_off (
  technician_id TEXT NOT NULL REFERENCES technicians (id),
  kind TEXT NOT NULL CHECK (kind IN ('time_to_leave', 'day_ahead', 'job_changes', 'running_over')),
  set_at TEXT NOT NULL,
  PRIMARY KEY (technician_id, kind)
);

-- backfill: none. Each trigger's INSERT … SELECT writes one alert for the one job a change names.

-- A job still to come in the next seven days, the week the phone's Schedule shows, moved to another time.
CREATE TRIGGER tech_alerts_job_moved AFTER UPDATE OF window_start ON appointments
WHEN NEW.window_start IS NOT OLD.window_start
  AND NEW.technician_id IS NOT NULL
  AND NEW.technician_id IS OLD.technician_id
  AND NEW.status IN ('scheduled', 'dispatched')
  AND NEW.deleted_at IS NULL
  AND min(OLD.window_start, NEW.window_start) < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days')
  AND max(OLD.window_start, NEW.window_start) > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
BEGIN
  INSERT OR IGNORE INTO tech_alerts (id, technician_id, kind, appointment_id, date, starts_at, was_starts_at, once_key, sent_at)
  SELECT lower(hex(randomblob(16))), NEW.technician_id, 'job_moved', NEW.id, date(NEW.window_start, '+330 minutes'),
         NEW.window_start, OLD.window_start, 'job_moved:' || NEW.id || ':' || NEW.window_start,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE NOT EXISTS (
     SELECT 1 FROM tech_alert_kinds_off WHERE technician_id = NEW.technician_id AND kind = 'job_changes'
   );
END;

-- A job still to come in the next seven days given to another technician: the one who had it is told.
CREATE TRIGGER tech_alerts_job_reassigned AFTER UPDATE OF technician_id ON appointments
WHEN OLD.technician_id IS NOT NULL
  AND NEW.technician_id IS NOT OLD.technician_id
  AND OLD.status IN ('scheduled', 'dispatched')
  AND OLD.deleted_at IS NULL
  AND OLD.window_start > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  AND OLD.window_start < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days')
BEGIN
  INSERT OR IGNORE INTO tech_alerts (id, technician_id, kind, appointment_id, date, starts_at, once_key, sent_at)
  SELECT lower(hex(randomblob(16))), OLD.technician_id, 'job_reassigned', NEW.id, date(OLD.window_start, '+330 minutes'),
         OLD.window_start, 'job_reassigned:' || NEW.id || ':' || OLD.window_start, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE NOT EXISTS (
     SELECT 1 FROM tech_alert_kinds_off WHERE technician_id = OLD.technician_id AND kind = 'job_changes'
   );
END;

-- A job still to come in the next seven days called off.
CREATE TRIGGER tech_alerts_job_cancelled AFTER UPDATE OF status ON appointments
WHEN NEW.status = 'cancelled'
  AND OLD.status IN ('scheduled', 'dispatched')
  AND NEW.technician_id IS NOT NULL
  AND NEW.window_start > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  AND NEW.window_start < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days')
BEGIN
  INSERT OR IGNORE INTO tech_alerts (id, technician_id, kind, appointment_id, date, starts_at, once_key, sent_at)
  SELECT lower(hex(randomblob(16))), NEW.technician_id, 'job_cancelled', NEW.id, date(NEW.window_start, '+330 minutes'),
         NEW.window_start, 'job_cancelled:' || NEW.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE NOT EXISTS (
     SELECT 1 FROM tech_alert_kinds_off WHERE technician_id = NEW.technician_id AND kind = 'job_changes'
   );
END;
