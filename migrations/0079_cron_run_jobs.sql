-- Migration number: 0079
-- The cron runs every minute, each run a few of its jobs (src/scheduled/cron.ts). The run record now names the jobs
-- the latest run started, so a run Cloudflare stopped part-way is told with the jobs it was running
-- (src/domain/cron-runs.ts). A new nullable column: the Worker already deployed writes nothing to it.

-- The latest run's jobs, comma-separated, as it started them.
ALTER TABLE cron_runs ADD COLUMN jobs TEXT;
