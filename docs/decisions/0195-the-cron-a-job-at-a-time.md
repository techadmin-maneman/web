# 0195. The cron a job at a time

- Status: accepted
- Date: 2026-10-13
- Topic: Platform
- Amends [0067](0067-alerts-and-silent-failures.md)

## Context

The cron runs every minute and takes the jobs due in that minute. One row of `cron_runs` was the lease for all of them: a run that found the one before unfinished within three minutes ran nothing, so one slow job held every other. `stock_watch` ran eight steps in sequence, so a throw in the forecast skipped the kit check and the alerts. And a job that does its work in one hour of the day returned early in the other twenty-three, each early return counted as a success: a daily job failing three nights running was never three in a row, and a night missed was not tried again until the next.

## Decision

1. **A lease per job.** A job takes its own lease in `cron_jobs` before it runs and lets it go after, so a run beside an unfinished one runs every job that run does not hold. The run's record stays the run before's while it is within three minutes, so a run cut short is still told.
2. **A slot for a day's or a week's work.** A job held to an hour of India's day, or of one weekday, names it as `slot`: the analytics copy and the stock's morning look, the task spans at 11 pm, the backup on Sundays at 3 am. It is due from its slot until it has run well since, so a slot missed, cut short or failed is caught up by the next hourly run, for the slot's own date. A job not due takes no lease and counts as nothing.
3. **Success is a job that ran.** Each job's last success is kept; three failures in a row alert as before, and a job held to a slot that has not run well for its period and two hours more alerts as missed (`cron_job_missed:<job>`), closing when it next runs well.
4. **The stock's steps are jobs of their own,** each in the same minute, each with its own outcome, reading the run's one read of the figures ops set.
5. **One trigger still.** Each job keeps its minute of the every-minute trigger. A trigger per cadence would run every hourly job in one invocation, past the statements one run may send (`CRON_STATEMENTS_PER_RUN`), and needs an operator's `apply-triggers` in each environment; with a lease per job, nothing waits on its neighbour.
6. **Long work leaves the cron.** The nightly analytics copy and the weekly backup run as Workflows, a step at a time with retries of their own ([0196](0196-long-work-in-workflows.md)).

## Consequences

- Each job costs its run two statements more, its lease and its outcome, and a quiet run's reads are budgeted a few rows a job (`cronRowsReadPerQuietRun`).
- The first run after this ships catches up every slotted job at once, each in its own minute of the hour.
- Tests: `test/worker/jobs/cron.test.ts`, `test/worker/jobs/cron-slots.test.ts`, `test/worker/jobs/cron-reads.test.ts`.
