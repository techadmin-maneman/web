# 0185. Cycle counts

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

The scope: cycle counts, never a yearly shutdown. Hair systems weekly at each place, adhesives monthly, the rest quarterly, each set as count tasks; ops can change the classes. Counts are blind: the counter never sees the expected figure, and a difference above a threshold needs a recount and a manager's sign-off. A missing piece is a case, never a quiet correction. Until now a count (ADR 0087) set a place to what was counted, whoever counted, with the figure in view.

## Decision

1. **Every item has a count class:** weekly, monthly or quarterly. Until ops set one on the Counts page, a hair system is weekly and the rest quarterly; adhesives are set monthly there.
2. **Each morning the stock watch raises a count task** for each standing place and class whose period has passed since its last task, where the place holds something of that class and has no task of it still open. Kits are places, counted from the console.
3. **A count is blind:** the task lists the items to count, never what the ledger holds, and must count every one of them.
4. **The tolerance:** a hair system that differs at all, or a consumable more than 5% (and more than one) off what was held, is counted again before the ledger takes it. Everything else goes straight in as a count (ADR 0087).
5. **A recount within the tolerance goes in; one that still differs waits for an Operations Manage sign-off, with why.** Only the sign-off shows what was held beside both counts. Signing off sets the place to the recount; a piece short goes missing, as any count makes it. Ops are told once a task waits (`count_differs:<task>`), and the alert closes when it is signed off.
6. **Counting, recounting and signing off are each claimed,** so two people counting the same task make one count.

## Consequences

- The Counts page lists the tasks in the caller's places and those done in the last week; Operations ACT counts, MANAGE signs off and sets classes.
- `POST /api/stock/counts` stays for opening counts and corrections outside a task.
- Tests: `test/node/policy/cycle-counts.test.ts`, `test/worker/ops/cycle-counts.test.ts`, `test/dom/ops-counts.test.ts`, `e2e/ops/counts.e2e.ts`.
