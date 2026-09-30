-- Migration number: 0060
-- Four groups of the Tasks board read only what can still be a task, not every
-- move, invite, piece or partial visit a client has ever had (the plan's WP-12;
-- docs/decisions/0072-ops-clients-and-queues.md). ADR 0009: past 5 million rows
-- read a day, D1 refuses every query until midnight UTC.
--
-- Call about a move and Referral review need only an index that holds the rows
-- still waiting. Replacement order and Visit left partly done need a flag each,
-- kept by triggers in the same statement as the rows behind it, so the Worker
-- already deployed, which reads neither flag, keeps both true until this release
-- reaches it. Only new columns, indexes and triggers, each filled from what is
-- there. No trigger body holds CASE (docs/migrations.md, rule 8).

-- A move ops made that its client may not have heard of: written to FSM and not
-- yet recorded as a call. The board reads those whose visit is still to come.
CREATE INDEX dispatch_moves_untold ON dispatch_moves (now_start)
  WHERE fsm_write_state = 'written' AND told_at IS NULL;

-- A grant the fraud rules held for ops' review.
CREATE INDEX referral_attributions_held ON referral_attributions (code) WHERE grant_state = 'held';

-- Whether a replacement is booked for the piece: a replacement visit of its
-- client's, not cancelled, on or after the day the piece fell due.
ALTER TABLE pieces ADD COLUMN replacement_booked INTEGER NOT NULL DEFAULT 0;

UPDATE pieces SET replacement_booked = EXISTS (
  SELECT 1 FROM appointments a
   WHERE a.person_id = pieces.person_id AND a.type = 'replacement' AND a.deleted_at IS NULL
     AND a.status NOT IN ('cancelled', 'terminated') AND a.window_start >= pieces.replacement_due_at)
 WHERE replacement_due_at IS NOT NULL;

-- The pieces due and not yet replaced, by the day each fell due.
CREATE INDEX pieces_to_replace ON pieces (replacement_due_at)
  WHERE replacement_booked = 0 AND deleted_at IS NULL AND failed_at IS NULL AND replacement_due_at IS NOT NULL;

CREATE TRIGGER pieces_replacement_booked_added AFTER INSERT ON pieces
WHEN NEW.replacement_due_at IS NOT NULL
BEGIN
  UPDATE pieces SET replacement_booked = EXISTS (
    SELECT 1 FROM appointments a
     WHERE a.person_id = pieces.person_id AND a.type = 'replacement' AND a.deleted_at IS NULL
       AND a.status NOT IN ('cancelled', 'terminated') AND a.window_start >= pieces.replacement_due_at)
   WHERE id = NEW.id;
END;

CREATE TRIGGER pieces_replacement_booked_changed AFTER UPDATE OF person_id, replacement_due_at ON pieces
WHEN OLD.person_id IS NOT NEW.person_id OR OLD.replacement_due_at IS NOT NEW.replacement_due_at
BEGIN
  UPDATE pieces SET replacement_booked = EXISTS (
    SELECT 1 FROM appointments a
     WHERE a.person_id = pieces.person_id AND a.type = 'replacement' AND a.deleted_at IS NULL
       AND a.status NOT IN ('cancelled', 'terminated') AND a.window_start >= pieces.replacement_due_at)
   WHERE id = NEW.id;
END;

-- A replacement visit booked, moved, cancelled or taken away works out its
-- client's pieces afresh; nothing else about an appointment moves the flag.
CREATE TRIGGER appointments_replacement_booked_added AFTER INSERT ON appointments
WHEN NEW.type = 'replacement'
BEGIN
  UPDATE pieces SET replacement_booked = EXISTS (
    SELECT 1 FROM appointments a
     WHERE a.person_id = pieces.person_id AND a.type = 'replacement' AND a.deleted_at IS NULL
       AND a.status NOT IN ('cancelled', 'terminated') AND a.window_start >= pieces.replacement_due_at)
   WHERE person_id = NEW.person_id AND replacement_due_at IS NOT NULL;
END;

CREATE TRIGGER appointments_replacement_booked_changed
AFTER UPDATE OF person_id, type, window_start, status, deleted_at ON appointments
WHEN (OLD.type = 'replacement' OR NEW.type = 'replacement')
  AND (OLD.person_id IS NOT NEW.person_id OR OLD.type IS NOT NEW.type OR OLD.window_start IS NOT NEW.window_start
    OR OLD.status IS NOT NEW.status OR OLD.deleted_at IS NOT NEW.deleted_at)
BEGIN
  UPDATE pieces SET replacement_booked = EXISTS (
    SELECT 1 FROM appointments a
     WHERE a.person_id = pieces.person_id AND a.type = 'replacement' AND a.deleted_at IS NULL
       AND a.status NOT IN ('cancelled', 'terminated') AND a.window_start >= pieces.replacement_due_at)
   WHERE person_id IN (OLD.person_id, NEW.person_id) AND replacement_due_at IS NOT NULL;
END;

CREATE TRIGGER appointments_replacement_booked_taken_out AFTER DELETE ON appointments
WHEN OLD.type = 'replacement'
BEGIN
  UPDATE pieces SET replacement_booked = EXISTS (
    SELECT 1 FROM appointments a
     WHERE a.person_id = pieces.person_id AND a.type = 'replacement' AND a.deleted_at IS NULL
       AND a.status NOT IN ('cancelled', 'terminated') AND a.window_start >= pieces.replacement_due_at)
   WHERE person_id = OLD.person_id AND replacement_due_at IS NOT NULL;
END;

-- Whether a visit left partly done has been followed: any visit of its client's,
-- not cancelled, booked after it.
ALTER TABLE visits ADD COLUMN followed_up INTEGER NOT NULL DEFAULT 0;

UPDATE visits SET followed_up = EXISTS (
  SELECT 1 FROM appointments a JOIN appointments later ON later.person_id = a.person_id
   WHERE a.id = visits.appointment_id AND later.deleted_at IS NULL
     AND later.status NOT IN ('cancelled', 'terminated') AND later.window_start > a.window_start)
 WHERE outcome = 'partial';

-- The partial visits no later visit has followed.
CREATE INDEX visits_partial_open ON visits (appointment_id) WHERE outcome = 'partial' AND followed_up = 0;

CREATE TRIGGER visits_followed_up_added AFTER INSERT ON visits
WHEN NEW.outcome = 'partial'
BEGIN
  UPDATE visits SET followed_up = EXISTS (
    SELECT 1 FROM appointments a JOIN appointments later ON later.person_id = a.person_id
     WHERE a.id = visits.appointment_id AND later.deleted_at IS NULL
       AND later.status NOT IN ('cancelled', 'terminated') AND later.window_start > a.window_start)
   WHERE id = NEW.id;
END;

CREATE TRIGGER visits_followed_up_changed AFTER UPDATE OF outcome, appointment_id ON visits
WHEN NEW.outcome = 'partial'
  AND (OLD.outcome IS NOT NEW.outcome OR OLD.appointment_id IS NOT NEW.appointment_id)
BEGIN
  UPDATE visits SET followed_up = EXISTS (
    SELECT 1 FROM appointments a JOIN appointments later ON later.person_id = a.person_id
     WHERE a.id = visits.appointment_id AND later.deleted_at IS NULL
       AND later.status NOT IN ('cancelled', 'terminated') AND later.window_start > a.window_start)
   WHERE id = NEW.id;
END;

-- Any visit of a client's booked, moved, cancelled or taken away works out their
-- partial visits afresh; nothing else about an appointment moves the flag.
CREATE TRIGGER appointments_followed_up_added AFTER INSERT ON appointments
BEGIN
  UPDATE visits SET followed_up = EXISTS (
    SELECT 1 FROM appointments a JOIN appointments later ON later.person_id = a.person_id
     WHERE a.id = visits.appointment_id AND later.deleted_at IS NULL
       AND later.status NOT IN ('cancelled', 'terminated') AND later.window_start > a.window_start)
   WHERE outcome = 'partial'
     AND appointment_id IN (SELECT id FROM appointments WHERE person_id = NEW.person_id);
END;

CREATE TRIGGER appointments_followed_up_changed
AFTER UPDATE OF person_id, window_start, status, deleted_at ON appointments
WHEN OLD.person_id IS NOT NEW.person_id OR OLD.window_start IS NOT NEW.window_start
  OR OLD.status IS NOT NEW.status OR OLD.deleted_at IS NOT NEW.deleted_at
BEGIN
  UPDATE visits SET followed_up = EXISTS (
    SELECT 1 FROM appointments a JOIN appointments later ON later.person_id = a.person_id
     WHERE a.id = visits.appointment_id AND later.deleted_at IS NULL
       AND later.status NOT IN ('cancelled', 'terminated') AND later.window_start > a.window_start)
   WHERE outcome = 'partial'
     AND appointment_id IN (SELECT id FROM appointments WHERE person_id IN (OLD.person_id, NEW.person_id));
END;

CREATE TRIGGER appointments_followed_up_taken_out AFTER DELETE ON appointments
BEGIN
  UPDATE visits SET followed_up = EXISTS (
    SELECT 1 FROM appointments a JOIN appointments later ON later.person_id = a.person_id
     WHERE a.id = visits.appointment_id AND later.deleted_at IS NULL
       AND later.status NOT IN ('cancelled', 'terminated') AND later.window_start > a.window_start)
   WHERE outcome = 'partial'
     AND appointment_id IN (SELECT id FROM appointments WHERE person_id = OLD.person_id);
END;
