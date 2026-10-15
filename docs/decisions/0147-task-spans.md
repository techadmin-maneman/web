# 0147. Task spans

- Status: accepted
- Date: 2026-10-12
- Topic: The ops console

## Context

The Customer care dashboard counts cases opened and closed each week, how long they stayed open, and those closed without doing. The Tasks board is worked out from the records each time it is read, so D1 knows when a task opened but not when it went: only a task ops closed by hand leaves a row, in `task_closures`.

## Decision

1. **Each night, in the hour from 11 pm in India, the cron reads the Tasks board** and writes a span in `task_spans` for each task it has not seen, from the task's own start, with the client's city. The span of each task no longer on the board is closed. Late in the day, so a task closed that day is dated that day.
2. **A board cut short at its read cap closes nothing**, since a task still open may be missing from it.
3. **A task is known by its group, its row and its episode**, as the board names it. One that comes back after it closed opens a new span.
4. **Grievances are not given spans**: their own table holds when each was raised and resolved.
5. **Tasks of records marked as tests get no span.** A span holds no name or number; the reporting copy sends it under a key of its own.
6. **The reporting copy's Care cases are the grievances and the spans** (ADR 0146). A span closed after ops closed its task by hand is marked closed without doing.

## Consequences

- Spans start on the night this is deployed: a task opened earlier gets its span then, from its own start, and the days before have no closed tasks.
- Tests: `test/worker/reports/task-spans.test.ts`.
