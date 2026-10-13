-- Migration number: 0165
-- Each cron job's own lease, when it last ran well, and when the cron first ran it, so one slow job holds only itself
-- and a daily job missed or failing is told (docs/decisions/0195-the-cron-a-job-at-a-time.md).
--
-- Nullable columns: the Worker already deployed reads none of them and keeps its one lease for the whole run.

ALTER TABLE cron_jobs ADD COLUMN lease_until TEXT;
ALTER TABLE cron_jobs ADD COLUMN last_success_at TEXT;
ALTER TABLE cron_jobs ADD COLUMN first_seen_at TEXT;

-- Every job now has a row, so each run's look at the failing ones reads only those.
CREATE INDEX cron_jobs_failing ON cron_jobs (job) WHERE failed_runs > 0;
