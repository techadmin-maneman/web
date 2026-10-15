# 0196. Long work in Workflows

- Status: accepted, on the owner's ruling of 13 October 2026
- Date: 2026-10-13
- Topic: Platform
- Amends [0146](0146-the-nightly-analytics-copy.md)

## Context

The nightly analytics copy and the weekly backup each ran inside one cron run: every table worked out, held in memory and written in one pass, under the cron's 30 seconds of CPU, with one attempt in their hour. The copy replaced its tables one at a time with no transaction, so a run cut short left Zoho reading a half-updated copy. The backup encrypted every table under one key, so it could only be written whole. The owner chose Cloudflare Workflows for both.

## Decision

1. **Each is a Workflow** (`src/workflows/`): `AnalyticsCopy`, a step for each part of the night, and `WeeklyBackup`, a step for each table. Each step is tried three times more, a minute apart and longer each time, and a run that fails for good tells ops (`analytics_copy_failed`, `backup_failed`).
2. **The cron starts one a night, or a week, named for its date** (`copy-<date>`, `backup-<Sunday>`), so the work is done once however often it is asked for, and follows it: the job is done when the run is complete, still due while it runs, and starts again a run that failed (ADR 0195's slots).
3. **The copy is put in at once.** Each part stages its tables in `analytics.load_rows`, its rows as JSON under their keys; the last step swaps every table in from them in one transaction, upserting so an unchanged row keeps its stamp, deleting what was not staged, then clearing the stage. Zoho reads last night's copy or tonight's whole. The table was made by the owner's admin login on 13 October 2026:

   ```sql
   create table analytics.load_rows (
     run_id text not null, table_name text not null, key text not null, row jsonb not null,
     primary key (run_id, table_name, key)
   );
   grant select, insert, delete on analytics.load_rows to analytics_writer;
   ```

4. **A key a table.** The backup's second format wraps each table's AES key with the owner's public key, so a table can be written by a step of its own, and no key is held in the Workflow's state. `scripts/ops/restore-backup.ts` reads both formats.
5. **No staging copy,** as ADR 0146 has it (the owner's ruling, 13 October 2026). Staging binds the copy's Workflow but never starts it.
6. **An operator creates them.** `wrangler versions upload`, which CI deploys with, binds a Workflow without creating it (cloudflare/workers-sdk#16001); `npm run apply-triggers` creates or updates it, as it attaches the cron, and the deploy's trigger check names one missing (ADR 0010).

## Consequences

- Workflows bill as Workers requests and CPU, and each run's state past the plan's gigabyte: a night and a week together, a few hundred steps, cost well under a cent a month (`COST_NOTES`, ADR 0194).
- The copy still works every table out from D1 each night; what changed is that only changed rows are written, and the whole night lands at once. Reading D1 incrementally waits until a table grows large enough to need it.
- Tests: `test/worker/jobs/workflows.test.ts`, `test/worker/jobs/analytics-nightly.test.ts`, `test/node/api/warehouse-postgres.test.ts`, `test/node/tooling/backups.test.ts`, `test/node/tooling/triggers.test.ts`.
