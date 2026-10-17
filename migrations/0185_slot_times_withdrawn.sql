-- A change of the window times may be withdrawn while it is the last, and no visit is booked or held from its day:
-- nobody was offered its times. Every other change stays for good, as before; the code deployed deletes none.
-- contract: docs/decisions/0102-window-times.md
DROP TRIGGER slot_times_no_delete;
CREATE TRIGGER slot_times_no_delete
BEFORE DELETE ON slot_times
WHEN EXISTS (SELECT 1 FROM slot_times later WHERE later.applies_from > OLD.applies_from)
  OR EXISTS (SELECT 1 FROM slot_holds WHERE state = 'held' AND date >= OLD.applies_from)
  OR EXISTS (SELECT 1 FROM appointments WHERE deleted_at IS NULL AND status IN ('scheduled', 'dispatched', 'in_progress')
             AND window_start >= strftime('%Y-%m-%dT%H:%M:%fZ', OLD.applies_from, '-330 minutes'))
BEGIN
  SELECT RAISE(ABORT, 'slot_times are append-only');
END;
