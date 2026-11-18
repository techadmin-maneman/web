-- Migration number: 0223
-- A technician in training (docs/decisions/0278-a-technician-in-training-takes-no-visits.md): offered and given no
-- visit of any kind until ops mark the training done. A new column: the Worker already deployed reads and writes none
-- of it.

-- The day ops expect the training to end, India's date, which the console shows. Null once ops mark it done, or for a
-- technician never in training: training ends when ops say so, not on the day.
ALTER TABLE technicians ADD COLUMN training_ends_on TEXT;

-- backfill: none. Every technician before this migration was taking visits, so none is in training.
