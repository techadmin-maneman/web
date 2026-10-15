# Customer Care, as it works now

How a client's word reaches us and is answered. One central Care team answers every chat; what needs a city goes to that city.

## The inbox

Every number that writes to our WhatsApp number has one thread, matched to its client where we know the number (`src/domain/care/inbox.ts`). A client who writes again reopens their thread. A number we do not know is a stranger until Care link it to the client writing from another phone, or save them by the name they gave (`src/domain/care/strangers.ts`). A client's word from the app that something is wrong with their hair system or a visit lands in the same thread (`src/domain/care/app-reports.ts`).

Care answer in their own words, from our number, and every reply is kept in the thread whether it went or not; a note only staff see; a thread closed when it is done (`src/domain/care/replies.ts`). Saved answers fill in the client's name and next visit (`src/domain/care/quick-replies.ts`). A Care reply goes to whoever wrote; only one to a test record off the allowlist is kept unsent. The after-hours answer, being automatic, goes only where every automatic message may (`src/policy/staging-test-records.ts`).

## Who answers, and by when

Each client has a named Care person, given at their first chat to the one with the fewest (`src/domain/care/care-people.ts`). Shifts, days off and who covers them are set by a Customer Care manager (`src/domain/care/cover.ts`).

The reply clock counts in Care's hours, set in Settings · Rules (`care_hours`): a chat past its reply-by time becomes a task on the Tasks board (`src/domain/care/chat-tasks.ts`). A message outside Care's hours gets, once a night, a word on when Care are back (`src/domain/care/after-hours.ts`). The Care numbers say whether the same-day promise held over a period (`src/domain/care/care-numbers.ts`).

## What Care can do

- **Send a matter to a city**, when it needs a technician's visit or a word with the city team: a City matter on that city's board, closed with what was done (`src/domain/care/city-matters.ts`).
- **Give a remedy**: free service visits with why, granted at once within the limit ops set (`remedy_limit`), above it waiting on a Customer Care manager (`src/domain/care/remedies.ts`).
- **Take a grievance**, answered within the 30 days the app promises (`src/domain/ops/grievances.ts`).

## The Tasks board

What ops still have to do is read from the queues themselves, never kept as a table (`src/domain/ops/tasks.ts`, `src/domain/ops/task-queues.ts`). Each statement keeps to the caller's cities, so one city's queues never crowd out another's, and every count is the whole queue (`src/domain/ops/task-reach.ts`). Each group's allowance is in Settings · Rules (`task_sla_hours`). A task leaves when its thing is done; a visit left partly done, an at-risk client and a City matter may be closed with why (`src/policy/tasks.ts`). An at-risk client leaves by itself once they count as lost (`lost_after_days`).

## Decisions still worth reading

- [0129, the Care inbox](../decisions/0129-the-care-inbox.md) and [0130, replies](../decisions/0130-replies-from-the-care-inbox.md).
- [0132, the reply clock](../decisions/0132-the-reply-clock.md) and [0135, city matters](../decisions/0135-city-matters.md).
- [0143, remedies](../decisions/0143-remedies.md).
- [0092, task owners](../decisions/0092-task-owners.md), for whose each task is and which close.
