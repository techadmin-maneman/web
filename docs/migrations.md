# Writing a migration

D1 runs each file in `migrations/` once, in order, in one transaction, with foreign keys on. A migration reaches staging and production while the previous Worker is still serving, so it must work with the code already deployed as well as the code it ships with. `npm run check:migrations` and the tests below hold most of this; the rest is here.

## The rules

1. **Forward only.** Never edit or delete a migration that has run anywhere; add a new one. One that every deploy refused can be withdrawn, and only withdrawn (see `migrations/0025_booking_leads.sql`).
2. **Expand now, contract later.** Add tables, columns and indexes freely. Dropping or renaming anything, or deleting rows, breaks the Worker still running. Do it in a later release, with a `-- contract: docs/decisions/NNNN-….md` line naming the ADR that sequences it.
3. **Number it after merging `main`.** Take the next free number, contiguous with the rest, and renumber if `main` takes it first.
4. **Never rebuild a table another table points at.** SQLite's recipe (create a copy, move the rows, drop the old one, rename) needs foreign keys switched off, and D1 ignores that pragma inside its transaction. Dropping the parent is a violation that re-creating it does not undo. Migration 0025 tried it on `leads`, which `tryon_jobs` points at, and staging refused it.
5. **Change a column on such a table by swapping it in place**, as migration 0031 does: add the new column, copy the values across, drop the old column, rename the new one. The table and every reference into it stay put. SQLite will not drop a column that is indexed, unique, a key, or named in a view, trigger or `CHECK` elsewhere: drop what depends on it first, and put it back after.
6. **No filler in place of "not known".** A `NOT NULL` column needs a real value for every row, old and new. `checkins.distance_m` began as `NOT NULL`, so a check-in with no address to measure against stored 0, the console showed "0 m" for it until its read learnt to tell the two apart, and the column then had to be swapped for a nullable one. Where a value can be missing, make the column nullable from the start.
7. **Name a time for what it holds.** A column ending `_at` holds an instant, as ISO 8601 in UTC (`2026-09-27T06:30:00.000Z`); one ending `_date` holds a calendar day in India (`2026-09-27`). Two `_at` columns hold a day, from before this rule was written, and `docs/schema.md` names them and how each is read; a new column does not add a third. After a migration adds or changes a table, run `npm run schema` to write `docs/schema.md` again: `test/node/schema-doc.test.ts` fails until it matches the migrations, and until a new table has its line in `PURPOSES` (`scripts/lib/schema-doc.ts`).
8. **No `CASE` inside a trigger's body; use `iif()`.** Wrangler splits a migration into statements before remote D1 runs it, and takes a `CASE`'s `END` for the trigger's own, so D1 refuses what follows ("incomplete input"). The local database runs a file whole and never sees it. Migration 0052 did this; staging refused it, and it was withdrawn and shipped again as 0053. `npm run check:migrations` refuses it.
9. **A short header; the reasoning lives in the ADR.** At most five comment lines open a migration, saying what it does. Name no open point by its number, since the open points were renumbered once, and hold no one environment's records: test data is written by a script run in that environment. Migration 0046 matches staging's test technicians by name, and 0100 its test records; both ran harmlessly in production, which has none. `npm run check:migrations` holds these from 0101 on.
10. **Size a backfill before writing it.** A statement that writes every row of a table (an `UPDATE` with no `WHERE`, or an `INSERT … SELECT`) carries a `-- backfill:` line estimating its writes: the table's rows × (1 + the indexes on it). D1 stops a statement at 30 seconds, and the free plan writes 100,000 rows a day across everything. Above about 10,000 writes, backfill in bounded batches from a script or the cron instead. `npm run check:migrations` asks for the line from 0101 on.

## Contract steps waiting

What a later release drops, once no deployed Worker reads it. Each waits for the release named, in **production** as well as staging.

| What                                         | Replaced by                                   | Dropped once production has run               | ADR  |
| -------------------------------------------- | --------------------------------------------- | --------------------------------------------- | ---- |
| `zoho_token` (0002) and `zoho_tokens` (0010) | `zoho_access_tokens` (0041, seeded from both) | #125 (6ef2ddb): the code before it reads them | 0070 |

## Comments an applied migration cannot correct

A migration's comments are part of it, so they are never edited either (rule 1), and some have gone out of date. What is true now:

| Migration                 | It says                                                             | True now                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any, citing an open point | "docs/open-points.md, item N"                                       | The open points were renumbered on 27 September 2026; `docs/open-points.md`, "Numbers before 27 September 2026", maps each old number to its new one                      |
| 0026 (field operations)   | "The milestone itself waits on Zoho's licensing answer"             | The owner ruled on 23 September 2026 that we build our own apps and go on, so P2-M4 went ahead; Zoho's written answer is still wanted (`docs/archive/fsm-licensing.md`) |
| 0027 (pieces and zones)   | The piece label's format "is a placeholder until the owner sets it" | Set on 24 September 2026: `MM-<base>-<digits>-<letter>`, typed by hand (`PIECE_CODE_PATTERN`, `src/config/pieces.ts`)                                                     |
| 0027 (pieces and zones)   | `fitted_at` and `replacement_due_at`, named as instants             | Each holds a calendar day, `YYYY-MM-DD` (`docs/schema.md`, "Times and dates")                                                                                             |

## Deleting rows

Every foreign key here is `NO ACTION`: deleting a row that another row points at fails the statement, and the whole batch it is in. The sweeper's housekeeping once deleted a technician's old session while his phone's row still pointed at it, and that stopped every cron job after it; an erasure failed the same way on a check-in and on a number change's codes.

So a statement that deletes from a table deals with every row pointing at it first, in the same batch: it clears the reference, deletes the child, or keeps the parent. `test/node/foreign-keys.test.ts` lists every such reference from the migrations and fails until each has a written answer. A new reference to a table the code deletes from therefore needs one too.

## Indexes

The five-minute cron runs 288 times a day in each environment, and past 5 million rows read a day D1 refuses every query until midnight UTC (ADR 0009). A lookup on the cron's path, or one made while a client pays, needs an index. Where it looks for rows still waiting on something, make it partial, `WHERE` that state, so it stays small however much history the table gathers (migration 0037). `test/node/query-plans.test.ts` plans every statement on those paths and fails on one that reads a growing table from end to end. `test/worker/cron-reads.test.ts` checks that a run reads no more over twice the history.

An index costs a write whenever a row it covers changes, and D1's free plan allows 100,000 rows written a day, so index what is looked up, not every column.

## Testing one

- `test/node/migrations-on-a-live-database.test.ts` runs every migration against a database that already holds rows, as staging's does. An empty schema hides what a real table would refuse.
- A test named for the migration (`test/node/migration-0026.test.ts` and its neighbours) checks what it changes.
