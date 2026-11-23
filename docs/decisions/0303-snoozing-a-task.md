# 0303. Snoozing a task

- Status: accepted
- Date: 2026-11-23
- Topic: The ops console

## Context

A task on Tasks waits until its thing is done, so one that cannot be done today, a client who asked to be called
tomorrow, stays on the board and in its counts all day. The redesign of 22 November draws "Snooze" in a task's panel,
which puts it away "until tomorrow 10 am". The owner asked for it on 23 November.

## Decision

1. **Snooze keeps a task off the board, and out of its counts, until 10 am the next day in India**, then it is back as
   it was, due when it was due. It is one button, as the prototype draws it; snoozing it again moves the moment.
2. **It is kept as an owner is** (`task_snoozes`, migration 0235): by the task's group, the id of the row it is read
   from, and its episode, so a new task about the same row is not snoozed.
3. **It asks what taking the task asks**: Act in the department that decides its group, within its city.
4. **The night's task spans still count a snoozed task open**: snoozing it is not doing it. Only the board people read
   leaves it out.

## Consequences

- Today's Needs you, the navigation's counts and Tasks leave a snoozed task out until the morning.
- A snooze says nothing about the client, so erasure keeps it, as it keeps a task's owner.
