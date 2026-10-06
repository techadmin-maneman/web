# Restoring D1

Part of the [runbook](../runbook.md), whose opening says how its commands are written.

**Never run `d1 export` against a live database in working hours.** An export holds the database while it runs: on 2 October 2026 one on staging failed a queue batch and a client's request. To look at the data, use Time Travel to a copy (below), or query it.

A read D1 fails for a reason that passes by itself (a lost connection, its storage reset, an export holding it) is tried twice more, a moment apart (`src/lib/d1-retry.ts`); a page that still fails answers 503 "unavailable" and is logged as `d1_unavailable`, not as an error of ours.

D1 Time Travel can put the database back to any minute in the last seven days (the Workers Free plan's window); `time-travel info` hands out bookmarks older than that, but they are not promised. A restore overwrites the whole database in place, cancels the queries running at the time, and undoes everything written since that minute. D1 is the only record of much of it, and the rest is in systems that will not send it again. So take the smallest repair that will do:

1. **Fix the rows by hand**, when you know what they should hold, from the logs, `audit_log` or the vendors' own records.
2. **Repair from an earlier minute**, when you need what the damaged rows held before: go back, copy the damaged tables, and come straight forward again. Every other table stays as it is now.
3. **Restore the whole database**, only when the database itself is broken: tables dropped, or damage in more places than you can name. Everything since that minute is undone, and you carry back what can be trusted.

The last two need `<T>`: the last good minute, in UTC, e.g. `2026-09-27T10:04:00Z`. `W d1 time-travel info maneman-<env> --env <env> --timestamp <T>` shows its bookmark. Work in `private/restore/`, which git ignores: what goes there holds personal data and the Zoho access tokens, and is deleted when you are done. `W d1 export` prints a link that downloads the whole database for an hour, so its output goes to `/dev/null`, as below, and never into a log or a chat.

Both run the Workers on the earlier database for a minute or two, so:

- **Choose a quiet time**, with no technician at work and nobody likely to be paying: after 10 pm India time.
- **Switch maintenance on first, and off at the end.** While it is on, the cron runs no job and each queue consumer hands its batch back for five minutes, so nothing acts on the earlier database. Left on for an hour, it tells ops. Going back to `<T>` undoes the switch with everything else, so each step that goes back switches it on again at once:

  ```sh
  on="INSERT OR REPLACE INTO maintenance (id, reason) VALUES (1, 'restoring D1')"
  W d1 execute maneman-<env> --env <env> --remote --command "$on"                       # on
  W d1 execute maneman-<env> --env <env> --remote --command "DELETE FROM maintenance"   # off
  ```

- **Pause the queues** as well, and resume them at the end. Paused, a message waits; handed back, it spends one of its few retries.

  ```sh
  for queue in render crm-sync messaging; do W queues pause-delivery mm-$queue-<t>; done
  for queue in render crm-sync messaging; do W queues resume-delivery mm-$queue-<t>; done
  ```

- **Start just after a cron run.** The cron runs at every minute that ends in 0 or 5; start at one ending in 1 or 6, so no run falls in the seconds between going back and the switch coming on again.
- **Ask ops to stay out of the console** until you are done.

Anything written while the Workers are on the earlier database is lost when you leave it. Afterwards, look in Razorpay's dashboard for any payment or refund made in those minutes ([Razorpay's webhook is not arriving](razorpay.md#razorpays-webhook-is-not-arriving)).

## Repairing from an earlier minute

```sh
mkdir -p private/restore
# 1. Switch maintenance on, and pause the queues (above).
# 2. Go back, and switch maintenance on again. Keep the bookmark it prints after "To undo this operation":
#    it is the database as it is now.
W d1 time-travel restore maneman-<env> --env <env> --timestamp <T> && W d1 execute maneman-<env> --env <env> --remote --command "$on"
# 3. Copy the damaged tables as they were then.
W d1 export maneman-<env> --env <env> --remote --no-schema --table <table> --table <table> --output private/restore/at-T.sql > /dev/null
# 4. Come straight back. The switch is on there, as you set it in step 1.
W d1 time-travel restore maneman-<env> --env <env> --bookmark <the bookmark from step 2>
# 5. Switch maintenance off, and resume the queues.
```

If step 3 fails, go on with step 4 all the same: until step 4 has run, the Workers are on the earlier database.

Then, with no hurry, load the copy beside the tables as they are now, each as `restore_<table>`:

```sh
tables='people leads'   # the damaged tables
{
  for table in $tables; do echo "CREATE TABLE restore_$table AS SELECT * FROM $table WHERE 0;"; done
  sed -nE 's/^INSERT INTO "([a-z_0-9]+)"/INSERT INTO "restore_\1"/p' private/restore/at-T.sql
} > private/restore/load.sql
W d1 execute maneman-<env> --env <env> --remote --file private/restore/load.sql
```

Put right what was damaged, with SQL written for the damage. Rows deleted since `<T>`, say:

```sql
INSERT INTO leads SELECT * FROM restore_leads WHERE id NOT IN (SELECT id FROM leads);
```

Or a column overwritten:

```sql
UPDATE people SET name = (SELECT r.name FROM restore_people r WHERE r.id = people.id)
WHERE erased_at IS NULL AND id IN (SELECT id FROM restore_people);
```

Leave alone what changed rightly since `<T>`: the second example passes over people erased since, whose name must stay "Erased". "What a restore undoes" in `docs/schema.md` is the list to think through. Then drop each `restore_` table and delete `private/restore`.

## Restoring the whole database

```sh
mkdir -p private/restore
# 1. Switch maintenance on, and pause the queues (above).
# 2. Copy everything as it is now, if it can still be read. The export holds up other queries while it runs.
W d1 export maneman-<env> --env <env> --remote --output private/restore/now.sql > /dev/null
# 3. Build the carry-back file. Name each table the restore is for with --leave: it stays as it was at <T>.
node scripts/release/restore-carry.ts private/restore/now.sql private/restore/carry.sql --leave <table>
# 4. Go back, and switch maintenance on again. Keep the bookmark it prints: restoring to it undoes this.
W d1 time-travel restore maneman-<env> --env <env> --timestamp <T> && W d1 execute maneman-<env> --env <env> --remote --command "$on"
# 5. Carry back what can be trusted.
W d1 execute maneman-<env> --env <env> --remote --file private/restore/carry.sql
# 6. Check the database is still this environment's.
node scripts/release/mark-database.ts <env> --check
# 7. Switch maintenance off, resume the queues, and run the smoke suite.
```

`scripts/release/restore-carry.ts` reads the tables and their triggers from the export itself, and prints how it treats each. Its file empties each table and fills it again as it was a moment ago, except that:

- a table that refuses a delete, such as `consents`, `audit_log`, `credit_ledger` or `hair_profiles`, only gains the rows it lacks, and its rows changed since are changed to match, so a hair profile an erasure blanked is blanked again;
- a table triggers write to, such as `last_visits` or `stock_balances`, is written last, as the export had it;
- `d1_migrations`, `deployment_identity` and the maintenance switch are never touched.

`test/worker/platform/restore-carry.test.ts` runs the same steps on a row in every table, so a migration the carry-back cannot pass fails its pull request.

A table dropped since `<T>` is not in `now.sql`, so it stays as it was at `<T>`, named or not. The file runs whole or not at all. It fails, and changes nothing, when a migration ran after `<T>`, as its rows then name tables or columns the restored database lacks (leave out the tables that migration changed), or when a table left at `<T>` points at a row a carried table no longer has (carry it too, or leave out the one it points at). Anything written between the restore and the carry-back is lost.

Then:

1. **A migration that ran after `<T>`** is undone with the rest, and the code serving expects it: roll mm-api back to the release before it ([Rolling back a Worker version](rolling-back.md)), or apply the migrations again once they are right.
2. **For each table left at `<T>`**, put back what "What a restore undoes" in `docs/schema.md` says for it. Its rows as they were a moment ago are in `now.sql`: load them as `restore_` tables, as "Repairing from an earlier minute" does.
3. Delete `private/restore`.

If nothing is left worth carrying (the export failed, or nothing in it can be trusted), everything since `<T>` is lost, and "What a restore undoes" is the list of what to put back from elsewhere.

## What a restore undoes

What each group of tables means if it is left as it was at `<T>`, and how it is put back, is in `docs/schema.md`, "What a restore undoes". `npm run schema` writes it from `RESTORE_GROUPS` in `scripts/lib/schema-doc.ts`, and its test fails on a table in no group, so a new table cannot leave the list behind.

---
