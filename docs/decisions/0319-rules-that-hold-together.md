# 0319. Rules that hold together

- Status: accepted
- Date: 2026-11-25
- Topic: The ops console

## Context

Settings checked each rule's own figures against each other (a booking rule's, the working day's, the drive estimate's,
Care's hours) and one rule against data (the booking horizon against the packages' service intervals). Nothing held one
rule against another, so the 25 November audit found pairs that could be set to contradict each other:

- **S1.** The check-in radius could be set wider than the radius at a rough pin, so the vaguer pin got the tighter
  circle; a city's own radius likewise.
- **S2.** The address could unlock before reminders go, when the evening's allotment fixes tomorrow's visits, so a
  technician could see the address and client card of a visit that then went to another: a privacy boundary
  (`src/policy/job-visibility.ts`). A city whose reminders go later than the nation's had the same gap.
- **S3.** The booking break could fall outside the working day.
- **S4.** A task's deadline could run longer than tasks wait before they lapse, so one left the board before it was
  ever overdue.

The audit also named the day-ahead jobs and the kit check against the reminder hour. Read in the code, neither needs a
guard: the day-ahead jobs go only once each city's lock has run (`src/scheduled/tech-alerts.ts`), and the kit check
counts tomorrow again on every run from its start hour (`src/domain/inventory/kit-check.ts`), so a start before the lock
is counted again after it.

The audit's S5, the forecast's horizon against suppliers' lead times, holds a rule against data: a lead time is a
supplier's own figure, changed as orders arrive. The owner ruled on 25 November that the plan flag it and Settings
refuse a horizon that falls short, rather than refuse the lead time or lengthen the forecast unasked.

## Decision

1. **Each pair is held when either side is saved** (`src/policy/setting-relations.ts`):
   - the check-in radius, the nation's or a city's, no wider than the radius at a rough pin;
   - the address unlock no earlier than the reminder hour, the nation's or any city's;
   - the booking break from no earlier than the working day opens, and to no later than it closes;
   - the lapse, in hours, no shorter than the longest task deadline, leaving out the queues of tasks written by hand,
     which lapse from their own due date.
2. **A save that would break its pair is refused** as `figures_conflict`, naming its own box and then the other rule's,
   from Settings (`POST /api/settings/{name}`) and from a city's own rules (`PATCH /api/cities/{name}/rules/{rule}`).
   The rule in force stays as it was. A reset to the default is held the same way, against the default it puts back.
3. **The console says each refusal in a sentence of its own**, "The break must fall within the working day.", not two
   boxes' names, since the other rule is on another page.
4. **The forecast reaches past every supplier's lead time and one period** (`src/domain/purchasing/lead-horizon.ts`),
   each stock code's lead time its cheapest live supplier's, as the supply plan picks it. The supply plan names each
   item whose lead time and a period run past it, with the days each needs and the forecast's reach; Settings refuses
   a horizon, or a planning period, that would leave one past it.
5. Figures already set that break a pair are left as they are; the guard is on the next save of either.

## Consequences

- Tests: `test/node/policy/setting-relations.test.ts` (each pair from both sides, every default holding),
  `test/worker/ops/ops-settings.test.ts`, `test/worker/ops/cities-refusals.test.ts`,
  `test/node/apps/ops/dom/ops-rule-refusals.test.ts`,
  `test/worker/purchasing/lead-horizon.test.ts`, `e2e/ops/settings.e2e.ts`, `e2e/ops/supply-plan.e2e.ts`.
