-- Migration number: 0099
-- What the retention job reads (src/domain/retention.ts), kept small however long the history grows.
--
-- A person's first visit or payment, kept by triggers as either is written: those who never had one are the only ones
-- the job looks at, and it erases them a year after their last sign of life, so that set stays small. Existing people
-- are given theirs from what they already have.
--
-- A check-in that still holds coordinates: the job blanks them once no no-show charge can be disputed over them, so
-- only the last few weeks' remain.
--
-- Expand only: a new column, its triggers, and two indexes. The Worker already deployed reads none of them.

ALTER TABLE people ADD COLUMN client_since TEXT;

UPDATE people SET client_since = (
  SELECT MIN(at) FROM (
    SELECT MIN(a.synced_at) AS at FROM appointments a WHERE a.person_id = people.id
    UNION ALL
    SELECT MIN(y.created_at) FROM payments y WHERE y.person_id = people.id
  )
);

CREATE TRIGGER people_client_by_visit AFTER INSERT ON appointments
WHEN NEW.person_id IS NOT NULL
BEGIN
  UPDATE people SET client_since = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.person_id AND client_since IS NULL;
END;

CREATE TRIGGER people_client_by_visit_given AFTER UPDATE OF person_id ON appointments
WHEN NEW.person_id IS NOT NULL
BEGIN
  UPDATE people SET client_since = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.person_id AND client_since IS NULL;
END;

CREATE TRIGGER people_client_by_payment AFTER INSERT ON payments
WHEN NEW.person_id IS NOT NULL
BEGIN
  UPDATE people SET client_since = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.person_id AND client_since IS NULL;
END;

CREATE TRIGGER people_client_by_payment_given AFTER UPDATE OF person_id ON payments
WHEN NEW.person_id IS NOT NULL
BEGIN
  UPDATE people SET client_since = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.person_id AND client_since IS NULL;
END;

CREATE INDEX people_never_clients ON people (created_at) WHERE erased_at IS NULL AND client_since IS NULL;
CREATE INDEX checkins_with_coordinates ON checkins (created_at) WHERE lat IS NOT NULL;
