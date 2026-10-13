-- The live visits by when they start, for the Tasks board's visits still open after their day
-- (src/domain/ops/tasks.ts): every visit ever made is in appointments, while the live ones stay few.

CREATE INDEX appointments_live_by_start ON appointments (window_start)
  WHERE status IN ('scheduled', 'dispatched', 'in_progress') AND deleted_at IS NULL;
