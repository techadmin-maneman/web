-- Migration number: 0213
-- A replacement may be booked from the first day of the month its hair system falls due
-- (docs/decisions/0253-replacement-when-due-and-change-of-hair-system.md), so one booked then counts as booked too.
-- The two piece triggers read the month's first day, and every piece is worked out afresh by it. The Worker deployed
-- reads the flag only, which this widens.

DROP TRIGGER pieces_replacement_booked_added;
DROP TRIGGER pieces_replacement_booked_changed;

CREATE TRIGGER pieces_replacement_booked_added AFTER INSERT ON pieces
WHEN NEW.replacement_due_at IS NOT NULL
BEGIN
  UPDATE pieces SET replacement_booked = EXISTS (
    SELECT 1 FROM appointments a
     WHERE a.person_id = pieces.person_id AND a.type = 'replacement' AND a.deleted_at IS NULL
       AND a.status NOT IN ('cancelled', 'terminated')
       AND a.window_start >= date(pieces.replacement_due_at, 'start of month'))
   WHERE id = NEW.id;
END;

CREATE TRIGGER pieces_replacement_booked_changed AFTER UPDATE OF person_id, replacement_due_at ON pieces
WHEN OLD.person_id IS NOT NEW.person_id OR OLD.replacement_due_at IS NOT NEW.replacement_due_at
BEGIN
  UPDATE pieces SET replacement_booked = EXISTS (
    SELECT 1 FROM appointments a
     WHERE a.person_id = pieces.person_id AND a.type = 'replacement' AND a.deleted_at IS NULL
       AND a.status NOT IN ('cancelled', 'terminated')
       AND a.window_start >= date(pieces.replacement_due_at, 'start of month'))
   WHERE id = NEW.id;
END;

UPDATE pieces SET replacement_booked = EXISTS (
  SELECT 1 FROM appointments a
   WHERE a.person_id = pieces.person_id AND a.type = 'replacement' AND a.deleted_at IS NULL
     AND a.status NOT IN ('cancelled', 'terminated')
     AND a.window_start >= date(pieces.replacement_due_at, 'start of month'))
 WHERE replacement_due_at IS NOT NULL;
