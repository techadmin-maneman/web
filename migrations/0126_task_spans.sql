-- Each task the Tasks board has held (docs/decisions/0147-task-spans.md): when it opened, and the hour it was first
-- found gone, written by the cron, so the reporting copy can count tasks opened and closed and how long each stayed open.
CREATE TABLE task_spans (
  id TEXT PRIMARY KEY,
  task_group TEXT NOT NULL,
  -- The task's row and episode, as the board names it; with the group, which task it is.
  subject_id TEXT NOT NULL,
  episode TEXT NOT NULL,
  -- The client's city when it opened; NULL where none is known.
  city TEXT,
  opened_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE UNIQUE INDEX task_spans_open ON task_spans (task_group, subject_id, episode) WHERE closed_at IS NULL;
CREATE INDEX task_spans_by_close ON task_spans (closed_at);
