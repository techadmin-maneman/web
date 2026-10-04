-- Migration number: 0089
-- A number that goes up whenever something the dispatch board draws changes: a visit booked, moved, started,
-- cancelled or taken off; a move written, or its client told; leave recorded or taken back; a technician added,
-- renamed or switched off; the day's slot times set. The open board asks for it every minute and reads itself again
-- only when it has moved. What the board draws from elsewhere (a client's name, a badge, a check-in) it reads again in
-- full every ten minutes.
--
-- Expand only: a new table, triggers that write only to it, and an index. The Worker already deployed reads none of
-- them.

CREATE TABLE board_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL
);

INSERT INTO board_version (id, version) VALUES (1, 0);

CREATE TRIGGER appointments_board_added AFTER INSERT ON appointments
BEGIN
  UPDATE board_version SET version = version + 1 WHERE id = 1;
END;

-- Only what the board draws: the sync and the invoice passes write other columns all day.
CREATE TRIGGER appointments_board_changed
AFTER UPDATE OF person_id, type, window_start, window_end, technician_id, status, service_city, service_pincode,
  deleted_at, asked_window, tier, one_visit ON appointments
WHEN OLD.person_id IS NOT NEW.person_id OR OLD.type IS NOT NEW.type OR OLD.window_start IS NOT NEW.window_start
  OR OLD.window_end IS NOT NEW.window_end OR OLD.technician_id IS NOT NEW.technician_id OR OLD.status IS NOT NEW.status
  OR OLD.service_city IS NOT NEW.service_city OR OLD.service_pincode IS NOT NEW.service_pincode
  OR OLD.deleted_at IS NOT NEW.deleted_at OR OLD.asked_window IS NOT NEW.asked_window OR OLD.tier IS NOT NEW.tier
  OR OLD.one_visit IS NOT NEW.one_visit
BEGIN
  UPDATE board_version SET version = version + 1 WHERE id = 1;
END;

CREATE TRIGGER appointments_board_taken_out AFTER DELETE ON appointments
BEGIN
  UPDATE board_version SET version = version + 1 WHERE id = 1;
END;

CREATE TRIGGER dispatch_moves_board_added AFTER INSERT ON dispatch_moves
BEGIN
  UPDATE board_version SET version = version + 1 WHERE id = 1;
END;

CREATE TRIGGER dispatch_moves_board_changed AFTER UPDATE OF fsm_write_state, message_id, told_at ON dispatch_moves
BEGIN
  UPDATE board_version SET version = version + 1 WHERE id = 1;
END;

CREATE TRIGGER technician_leave_board_added AFTER INSERT ON technician_leave
BEGIN
  UPDATE board_version SET version = version + 1 WHERE id = 1;
END;

CREATE TRIGGER technician_leave_board_changed AFTER UPDATE ON technician_leave
BEGIN
  UPDATE board_version SET version = version + 1 WHERE id = 1;
END;

CREATE TRIGGER technicians_board_added AFTER INSERT ON technicians
BEGIN
  UPDATE board_version SET version = version + 1 WHERE id = 1;
END;

-- Only what the board draws: the sync writes `updated_at` on every pass.
CREATE TRIGGER technicians_board_changed AFTER UPDATE OF name, initials, zone, active, city ON technicians
WHEN OLD.name IS NOT NEW.name OR OLD.initials IS NOT NEW.initials OR OLD.zone IS NOT NEW.zone
  OR OLD.active IS NOT NEW.active OR OLD.city IS NOT NEW.city
BEGIN
  UPDATE board_version SET version = version + 1 WHERE id = 1;
END;

CREATE TRIGGER slot_times_board_added AFTER INSERT ON slot_times
BEGIN
  UPDATE board_version SET version = version + 1 WHERE id = 1;
END;

-- A client's latest word on one purpose, which the board reads for every visit in its week, found without reading
-- his others.
CREATE INDEX consents_by_person_purpose ON consents (person_id, purpose, created_at);

-- How far the technician has got on a visit, which the board reads for every visit in its week, found without reading
-- the visit's other steps.
CREATE INDEX job_events_by_appointment_kind ON job_events (appointment_id, kind);
