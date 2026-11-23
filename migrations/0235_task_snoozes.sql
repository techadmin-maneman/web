-- A task snoozed on Tasks (docs/decisions/0303-snoozing-a-task.md): kept off the board, and out of its counts, until a
-- moment, then back as it was. Keyed as an owner is (migration 0056): by the task's group, the id of the row it is
-- read from, its episode, and when it started waiting as the board read it, so a new task about the same row, a chat
-- the client wrote to again, is not snoozed.
-- backfill: none. A new table: nothing was snoozed before it.

CREATE TABLE task_snoozes (
  task_group TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  episode TEXT NOT NULL,
  task_since TEXT NOT NULL,
  until TEXT NOT NULL,
  snoozed_by TEXT NOT NULL,
  snoozed_at TEXT NOT NULL,
  PRIMARY KEY (task_group, subject_id)
);

-- The board reads the snoozes still running.
CREATE INDEX task_snoozes_until ON task_snoozes (until);
