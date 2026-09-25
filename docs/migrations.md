# Writing a migration

D1 runs each file in `migrations/` once, in order, in one transaction, with foreign keys on. A migration reaches staging and production while the previous Worker is still serving, so it must work with the code already deployed as well as the code it ships with. `npm run check:migrations` and the tests below hold most of this; the rest is here.

## The rules

1. **Forward only.** Never edit or delete a migration that has run anywhere; add a new one. One that every deploy refused can be withdrawn, and only withdrawn (see `migrations/0025_booking_leads.sql`).
2. **Expand now, contract later.** Add tables, columns and indexes freely. Dropping or renaming anything, or deleting rows, breaks the Worker still running. Do it in a later release, with a `-- contract: docs/decisions/NNNN-….md` line naming the ADR that sequences it.
3. **Number it after merging `main`.** Take the next free number, contiguous with the rest, and renumber if `main` takes it first.
4. **Never rebuild a table another table points at.** SQLite's recipe (create a copy, move the rows, drop the old one, rename) needs foreign keys switched off, and D1 ignores that pragma inside its transaction. Dropping the parent is a violation that re-creating it does not undo. Migration 0025 tried it on `leads`, which `tryon_jobs` points at, and staging refused it.
5. **Change a column on such a table by swapping it in place**, as migration 0031 does: add the new column, copy the values across, drop the old column, rename the new one. The table and every reference into it stay put. SQLite will not drop a column that is indexed, unique, a key, or named in a view, trigger or `CHECK` elsewhere: drop what depends on it first, and put it back after.
6. **No filler in place of "not known".** A `NOT NULL` column needs a real value for every row, old and new. `checkins.distance_m` began as `NOT NULL`, so a check-in with no address to measure against stored 0, the console showed "0 m" for it until its read learnt to tell the two apart, and the column then had to be swapped for a nullable one. Where a value can be missing, make the column nullable from the start.

## Deleting rows

Every foreign key here is `NO ACTION`: deleting a row that another row points at fails the statement, and the whole batch it is in. The sweeper's housekeeping once deleted a technician's old session while his phone's row still pointed at it, and that stopped every cron job after it; an erasure failed the same way on a check-in and on a number change's codes.

So a statement that deletes from a table deals with every row pointing at it first, in the same batch: it clears the reference, deletes the child, or keeps the parent. `test/node/foreign-keys.test.ts` lists every such reference from the migrations and fails until each has a written answer. A new reference to a table the code deletes from therefore needs one too.

## Indexes

The five-minute cron runs 288 times a day in each environment, and past 5 million rows read a day D1 refuses every query until midnight UTC (ADR 0009). A lookup on the cron's path, or one made while a client pays, needs an index. Where it looks for rows still waiting on something, make it partial, `WHERE` that state, so it stays small however much history the table gathers (migration 0037). `test/node/query-plans.test.ts` plans every statement on those paths and fails on one that reads a growing table from end to end. `test/worker/cron-reads.test.ts` checks that a run reads no more over twice the history.

An index costs a write whenever a row it covers changes, and D1's free plan allows 100,000 rows written a day, so index what is looked up, not every column.

## Testing one

- `test/node/migrations-on-a-live-database.test.ts` runs every migration against a database that already holds rows, as staging's does. An empty schema hides what a real table would refuse.
- A test named for the migration (`test/node/migration-0026.test.ts` and its neighbours) checks what it changes.
