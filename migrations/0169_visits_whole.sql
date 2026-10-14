-- Migration number: 0169
-- A visit is held whole, with a client, a kind, a start, an end and one of our own statuses; and what a visit came to
-- is named for it, visit_outcomes, with a view of the old name for the Worker still serving until the next release.
-- contract: docs/decisions/0199-derived-state-in-the-domain.md

CREATE TRIGGER appointments_whole BEFORE INSERT ON appointments
WHEN NEW.person_id IS NULL OR NEW.type IS NULL OR NEW.window_start IS NULL OR NEW.window_end IS NULL
  OR NEW.status NOT IN ('scheduled', 'dispatched', 'in_progress', 'completed', 'cancelled', 'terminated')
BEGIN
  SELECT RAISE(ABORT, 'appointments: a visit has a client, a kind, a start, an end and one of our statuses');
END;

CREATE TRIGGER appointments_kept_whole BEFORE UPDATE OF person_id, type, window_start, window_end, status ON appointments
WHEN NEW.person_id IS NULL OR NEW.type IS NULL OR NEW.window_start IS NULL OR NEW.window_end IS NULL
  OR NEW.status NOT IN ('scheduled', 'dispatched', 'in_progress', 'completed', 'cancelled', 'terminated')
BEGIN
  SELECT RAISE(ABORT, 'appointments: a visit has a client, a kind, a start, an end and one of our statuses');
END;

ALTER TABLE visits RENAME TO visit_outcomes;

CREATE VIEW visits AS
SELECT id, appointment_id, started_at, ended_at, duration_minutes, outcome, partial_reason, updated_at, followed_up,
       closed_by, close_reason, lost_reason
  FROM visit_outcomes;

CREATE TRIGGER visits_written INSTEAD OF INSERT ON visits
BEGIN
  INSERT INTO visit_outcomes (id, appointment_id, started_at, ended_at, duration_minutes, outcome, partial_reason,
                              updated_at, followed_up, closed_by, close_reason, lost_reason)
  VALUES (NEW.id, NEW.appointment_id, NEW.started_at, NEW.ended_at, NEW.duration_minutes, NEW.outcome,
          NEW.partial_reason, NEW.updated_at, COALESCE(NEW.followed_up, 0), NEW.closed_by, NEW.close_reason,
          NEW.lost_reason);
END;

CREATE TRIGGER visits_changed INSTEAD OF UPDATE ON visits
BEGIN
  UPDATE visit_outcomes
     SET appointment_id = NEW.appointment_id, started_at = NEW.started_at, ended_at = NEW.ended_at,
         duration_minutes = NEW.duration_minutes, outcome = NEW.outcome, partial_reason = NEW.partial_reason,
         updated_at = NEW.updated_at, followed_up = NEW.followed_up, closed_by = NEW.closed_by,
         close_reason = NEW.close_reason, lost_reason = NEW.lost_reason
   WHERE id = OLD.id;
END;

CREATE TRIGGER visits_taken_out INSTEAD OF DELETE ON visits
BEGIN
  DELETE FROM visit_outcomes WHERE id = OLD.id;
END;
