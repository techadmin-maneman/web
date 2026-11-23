# 0302. Tasks written by hand

- Status: accepted
- Date: 2026-11-23
- Topic: The ops console

## Context

Every task on Tasks is read from a queue the database already keeps, at the moment ops look (ADR 0092): a visit with
no technician, a chat past its reply-by time, a replacement to order. Nothing else is a task, so a call ops promise a
client, or a check one department asks of another, lives outside the console. The redesign of 22 November draws a
"New task" on Tasks: what needs doing, the client, when it is due, and whose it is. The owner asked for it on 23
November, with an erased client's tasks deleted, anyone who opens Tasks able to write one, and the form asking which
department it is for, whose people alone see it.

## Decision

1. **A task written by hand is a row of its own** (`staff_tasks`, migration 0234): what needs doing (200 characters at
   most), the department it is for, the client it is about if any, its city, when it is due, who wrote it, and who
   marked it done.
2. **The board reads the open ones as one group per department** (`staff_task_operations`, `staff_task_customer_care`,
   and so on; src/domain/ops/staff-tasks.ts). Each group is its department's (src/policy/task-departments.ts), so who
   sees one, who may take it and who may mark it done follow the rules every other group follows. It is due when its
   writer said; its words are its line on the board.
3. **Anyone who opens Tasks may write one, for any department**, about a client or a city their work reaches in any of
   their departments; with no client and no city, only someone whose work reaches every city may. A task about a
   client is in the client's city, else in the city it was written for. One written for someone is theirs at once.
4. **Marking it done asks Act in the department it is for**, within its city, as taking a task does. It leaves the
   board; the row and who did it stay.
5. **An erased client's tasks are deleted with the rest of their record.** The words may name them, so they are never
   written to the log either: the log keeps the group and the owner.

## Consequences

- A department hands work to another on the board both read, instead of in a chat.
- The board's queues grow by five arms, each reading only the open rows by an index.
- A task written by hand has no step of its own to settle it: its client opens their record, and Mark done ends it.
