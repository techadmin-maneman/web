-- Migration number: 0068
-- The five-minute cron's run record, so a run Cloudflare stopped part-way is noticed by the next one
-- (src/domain/cron-runs.ts). A new table, empty: the Worker already deployed reads nothing of it.

-- One row. A run writes started_at as it starts and completed_at as it finishes, so a run that finds started_at later
-- than completed_at knows the run before it never finished.
CREATE TABLE cron_runs (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  started_at TEXT NOT NULL,
  -- When the last run to finish did so, which a run in progress leaves in place; empty until one has.
  completed_at TEXT,
  -- How many of that run's jobs failed.
  failed_jobs INTEGER,
  -- When a run last found the one before it cut short; emptied once runs have finished for an hour after.
  cut_short_at TEXT
);
