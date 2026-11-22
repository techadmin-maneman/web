-- A technician is told of a job moved, given to another or called off only where it was theirs to know of: fixed, not
-- a draft the evening's re-plan may still change, which their phone does not list
-- (docs/decisions/0290-allotted-the-evening-before.md).
-- The three triggers of 0209 are made again, each with that one condition more.
-- backfill: none. The triggers change; no row is written.

DROP TRIGGER tech_alerts_job_moved;
DROP TRIGGER tech_alerts_job_reassigned;
DROP TRIGGER tech_alerts_job_cancelled;

CREATE TRIGGER tech_alerts_job_moved AFTER UPDATE OF window_start ON appointments
WHEN NEW.window_start IS NOT OLD.window_start
  AND OLD.technician_draft = 0
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

-- A job still to do in the next seven days given to another technician, a late one included as its technician waits at
-- the door: the one who had it is told.
CREATE TRIGGER tech_alerts_job_reassigned AFTER UPDATE OF technician_id ON appointments
WHEN OLD.technician_id IS NOT NULL
  AND OLD.technician_draft = 0
  AND NEW.technician_id IS NOT OLD.technician_id
  AND OLD.status IN ('scheduled', 'dispatched')
  AND OLD.deleted_at IS NULL
  AND OLD.window_start > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 hours')
  AND OLD.window_start < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days')
BEGIN
  INSERT OR IGNORE INTO tech_alerts (id, technician_id, kind, appointment_id, date, starts_at, once_key, sent_at)
  SELECT lower(hex(randomblob(16))), OLD.technician_id, 'job_reassigned', NEW.id, date(OLD.window_start, '+330 minutes'),
         OLD.window_start, 'job_reassigned:' || NEW.id || ':' || OLD.window_start, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE NOT EXISTS (
     SELECT 1 FROM tech_alert_kinds_off WHERE technician_id = OLD.technician_id AND kind = 'job_changes'
   );
END;

-- A job still to do in the next seven days called off, a late one included.
CREATE TRIGGER tech_alerts_job_cancelled AFTER UPDATE OF status ON appointments
WHEN NEW.status = 'cancelled'
  AND OLD.technician_draft = 0
  AND OLD.status IN ('scheduled', 'dispatched')
  AND NEW.technician_id IS NOT NULL
  AND NEW.window_start > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 hours')
  AND NEW.window_start < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days')
BEGIN
  INSERT OR IGNORE INTO tech_alerts (id, technician_id, kind, appointment_id, date, starts_at, once_key, sent_at)
  SELECT lower(hex(randomblob(16))), NEW.technician_id, 'job_cancelled', NEW.id, date(NEW.window_start, '+330 minutes'),
         NEW.window_start, 'job_cancelled:' || NEW.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE NOT EXISTS (
     SELECT 1 FROM tech_alert_kinds_off WHERE technician_id = NEW.technician_id AND kind = 'job_changes'
   );
END;

-- A technician ops chose when booking in the console: the visit is booked fixed with them, never a draft the re-plan may
-- give another.
ALTER TABLE slot_holds ADD COLUMN technician_chosen INTEGER NOT NULL DEFAULT 0 CHECK (technician_chosen IN (0, 1));
