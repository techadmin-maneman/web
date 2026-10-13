-- Migration number: 0162
-- Labelled hair systems counted by their labels, and a count of one item started by ops (ADR 0185).
--
-- New nullable columns: the Worker already deployed reads none of them, and counts by number as it did.

-- JSON arrays: the labels last scanned, those held and not scanned (gone missing), and those not held there.
ALTER TABLE count_lines ADD COLUMN labels TEXT;
ALTER TABLE count_lines ADD COLUMN missing_labels TEXT;
ALTER TABLE count_lines ADD COLUMN unknown_labels TEXT;

-- A task of one item, and who started it; both NULL on the morning's tasks of a class. No foreign key, as place_id has
-- none: an item added by mistake is deleted, and a task of it then reads by its code.
ALTER TABLE count_tasks ADD COLUMN consumable_code TEXT;
ALTER TABLE count_tasks ADD COLUMN started_by TEXT;
