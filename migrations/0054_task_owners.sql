-- Migration number: 0054
-- Whose each task on the Tasks board is, a visit left partly done that ops
-- closed without a follow-up, and an address a client gave ops on the phone
-- (docs/decisions/0092-task-owners.md; the plan's pieces C7 and C8, open points
-- 61 and 62). And the two groups of the board that read every request a lead
-- ever made read only those that can still be a task.
--
-- A task is still read from the queues at the moment ops look: nothing here is a
-- copy of one. What is kept is about a task, keyed by its group and the id of
-- the row it is read from, which no later task reuses.
--
-- New tables, new nullable columns or columns with a default, triggers, indexes,
-- each filled from what is there: the Worker already deployed reads none of it,
-- and the triggers keep it true while that Worker writes.

-- The member of staff a task is theirs, by their Access e-mail. A task with no
-- row here has no owner. A row whose task has gone, because its thing was done,
-- is left behind and never read: nothing else has that group and id.
CREATE TABLE task_owners (
  task_group TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (task_group, subject_id)
);

-- A task ops closed without doing its thing, with why and who closed it. Only a
-- visit left partly done may be (src/policy/tasks.ts); it stays closed, and a
-- later visit left partly done is a task of its own.
CREATE TABLE task_closures (
  id TEXT PRIMARY KEY,
  task_group TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  -- Ops' own words about the client's visit; NULL once the client is erased.
  reason TEXT,
  closed_by TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  UNIQUE (task_group, subject_id)
);

-- The Access e-mail of the member of staff a client gave the address to on the
-- phone, who saved it for them; NULL for an address the client saved.
ALTER TABLE addresses ADD COLUMN given_to_staff TEXT;

-- Whether the client has a consultation booked or done: one not cancelled,
-- terminated or deleted. A request is a task while they have none, so the board
-- reads only the requests with none, however many leads have asked before.
ALTER TABLE consultation_requests ADD COLUMN booked INTEGER NOT NULL DEFAULT 0;

UPDATE consultation_requests
   SET booked = EXISTS (
     SELECT 1 FROM appointments a
      WHERE a.person_id = consultation_requests.person_id AND a.type = 'consultation' AND a.deleted_at IS NULL
        AND a.status NOT IN ('cancelled', 'terminated'));

CREATE INDEX consultation_requests_waiting ON consultation_requests (created_at) WHERE booked = 0;

CREATE TRIGGER consultation_requests_booked_asked AFTER INSERT ON consultation_requests
BEGIN
  UPDATE consultation_requests
     SET booked = EXISTS (
       SELECT 1 FROM appointments a
        WHERE a.person_id = NEW.person_id AND a.type = 'consultation' AND a.deleted_at IS NULL
          AND a.status NOT IN ('cancelled', 'terminated'))
   WHERE id = NEW.id;
END;

CREATE TRIGGER appointments_consultation_booked_added AFTER INSERT ON appointments
WHEN NEW.type = 'consultation'
BEGIN
  UPDATE consultation_requests
     SET booked = EXISTS (
       SELECT 1 FROM appointments a
        WHERE a.person_id = consultation_requests.person_id AND a.type = 'consultation' AND a.deleted_at IS NULL
          AND a.status NOT IN ('cancelled', 'terminated'))
   WHERE person_id = NEW.person_id;
END;

CREATE TRIGGER appointments_consultation_booked_changed
AFTER UPDATE OF person_id, type, status, deleted_at ON appointments
WHEN (OLD.type = 'consultation' OR NEW.type = 'consultation')
  AND (OLD.person_id IS NOT NEW.person_id OR OLD.type IS NOT NEW.type OR OLD.status IS NOT NEW.status
    OR OLD.deleted_at IS NOT NEW.deleted_at)
BEGIN
  UPDATE consultation_requests
     SET booked = EXISTS (
       SELECT 1 FROM appointments a
        WHERE a.person_id = consultation_requests.person_id AND a.type = 'consultation' AND a.deleted_at IS NULL
          AND a.status NOT IN ('cancelled', 'terminated'))
   WHERE person_id IN (OLD.person_id, NEW.person_id);
END;

CREATE TRIGGER appointments_consultation_booked_taken_out AFTER DELETE ON appointments
WHEN OLD.type = 'consultation'
BEGIN
  UPDATE consultation_requests
     SET booked = EXISTS (
       SELECT 1 FROM appointments a
        WHERE a.person_id = consultation_requests.person_id AND a.type = 'consultation' AND a.deleted_at IS NULL
          AND a.status NOT IN ('cancelled', 'terminated'))
   WHERE person_id = OLD.person_id;
END;

-- Whether the client has had a first fit, service or replacement done since
-- their last consultation, or with none: read from last_visits, which keeps
-- both (migration 0053). A first fit asked for can be a task only while they
-- have not, so the board reads only those requests, however many clients have
-- been fitted since they asked.
ALTER TABLE first_fit_requests ADD COLUMN fitted_since INTEGER NOT NULL DEFAULT 0;

UPDATE first_fit_requests
   SET fitted_since = COALESCE((
     SELECT s.visit_start IS NOT NULL AND (s.consulted_start IS NULL OR s.visit_start > s.consulted_start)
       FROM last_visits s WHERE s.person_id = first_fit_requests.person_id), 0);

CREATE INDEX first_fit_requests_unfitted ON first_fit_requests (person_id) WHERE fitted_since = 0;

CREATE TRIGGER first_fit_requests_fitted_asked AFTER INSERT ON first_fit_requests
BEGIN
  UPDATE first_fit_requests
     SET fitted_since = COALESCE((
       SELECT s.visit_start IS NOT NULL AND (s.consulted_start IS NULL OR s.visit_start > s.consulted_start)
         FROM last_visits s WHERE s.person_id = NEW.person_id), 0)
   WHERE id = NEW.id;
END;

CREATE TRIGGER last_visits_fitted_added AFTER INSERT ON last_visits
BEGIN
  UPDATE first_fit_requests
     SET fitted_since = NEW.visit_start IS NOT NULL
       AND (NEW.consulted_start IS NULL OR NEW.visit_start > NEW.consulted_start)
   WHERE person_id = NEW.person_id;
END;

CREATE TRIGGER last_visits_fitted_changed AFTER UPDATE OF visit_start, consulted_start ON last_visits
BEGIN
  UPDATE first_fit_requests
     SET fitted_since = NEW.visit_start IS NOT NULL
       AND (NEW.consulted_start IS NULL OR NEW.visit_start > NEW.consulted_start)
   WHERE person_id = NEW.person_id;
END;
