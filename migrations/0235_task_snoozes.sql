-- A task snoozed on Tasks (docs/decisions/0303-snoozing-a-task.md): kept off the board, and out of its counts, until a
-- moment, then back as it was. Keyed as an owner is (migration 0056): by the task's group, the id of the row it is
-- read from, and, where that row can be a new task again, its episode, so a new task about the same row is not snoozed.
-- backfill: none. A new table: nothing was snoozed before it.

CREATE TABLE task_snoozes (
  task_group TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  episode TEXT NOT NULL,
  until TEXT NOT NULL,
  snoozed_by TEXT NOT NULL,
  snoozed_at TEXT NOT NULL,
  PRIMARY KEY (task_group, subject_id)
);
