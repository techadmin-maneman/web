# 0199. Derived state in the domain

- Status: accepted
- Date: 2026-10-14
- Topic: Platform
- Amends [0113](0113-fsms-columns-go.md)

## Context

The migrations made 62 triggers. Sixteen are guards (append-only, no update, no delete); the other 46 keep derived state up: the dispatch board's version, whether a consultation request is booked, whether a partial visit was followed up, each client's last visit, whether a piece's replacement is booked, when a person became a client, and stock balances. Nineteen fire on `appointments` alone. A reader of the TypeScript cannot see half of what a write does, no type or lint covers a trigger's body, and changing one means dropping and making it again. The visit table is still shaped as the FSM mirror it began as: its client, kind and times may be empty, its statuses include FSM's `other`, and its outcome table is named `visits`, so "visit" means two things.

## Decision

1. **A visit's derived state is kept up by `visitUpkeep`** (`src/domain/visits/visit-upkeep.ts`): every write to a visit's client, kind, times, status or technician adds its statements to the write's own batch, and each value is worked out again from the visits as they now stand. The test fixtures write a visit through it too (`aVisit`, `keepUpVisits`).
2. **The guards stay** as triggers: what may never be updated or deleted is the database's to refuse.
3. **The appointments triggers go in the contract step** after this release, once no deployed Worker relies on them (migration 0168). **The visit is made whole one release later** (migration 0169), once the deployed Worker's own tests write only whole visits: a guard refuses a visit with no client, kind, start or end, or with a status not our own. D1 cannot make the client's column `NOT NULL` in place, since a column that points at people takes no default but NULL, and the table cannot be rebuilt while others point at it (docs/migrations.md, rule 4), so the guard holds what the column cannot, and `src/lib/rows.ts` types the four columns whole. The outcome table is renamed then for what it holds, `visit_outcomes`, so "visit" means one thing, with a view of the old name for the Worker still running, dropped a release later (migration 0170). SQLite takes no upsert on a view, so the outcome is written once by `NOT EXISTS`, not `ON CONFLICT`.
4. **The other derived triggers move the same way**, a table at a time, when that table's writes are next changed.
5. **New code takes its row types from the schema** (`src/lib/rows.ts`, written by `npm run schema`).

## Consequences

- The contract step's migration waits in docs/migrations.md, "Contract steps waiting".
- A write that leaves out its upkeep shows as a stale board or task: the worker suite was run once with the appointments triggers dropped and passed but for the tests that list the triggers themselves.
- Tests: `test/worker/booking/`, `test/worker/ops/dispatch-board.test.ts`, `test/worker/ops/ops-tasks*.test.ts`.
