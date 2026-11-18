-- Migration number: 0223
-- A technician in training (docs/decisions/0278-a-technician-in-training-takes-no-visits.md): offered and given no
-- visit of any kind until ops mark the training done. A new column: the Worker already deployed reads and writes none
-- of it.

-- The day the training is expected to end, which the console shows; null once ops mark it done, or never in training.
ALTER TABLE technicians ADD COLUMN training_end_date TEXT;

-- backfill: none. Every technician before this migration was taking visits, so none is in training.
