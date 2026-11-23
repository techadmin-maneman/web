-- A task ops write themselves on Tasks (docs/decisions/0302-tasks-written-by-hand.md): what needs doing, the department
-- it is for, the client it is about if any, its city (the client's, else the one it was written in), when it is due,
-- who wrote it, and who did it. The board reads the open ones as one group per department (src/domain/ops/task-queues.ts),
-- so each department's people see their own. An erased client's are deleted with the rest of their record.
-- backfill: none. A new table: nothing before it was written by hand.

CREATE TABLE staff_tasks (
  id TEXT PRIMARY KEY,
  department TEXT NOT NULL CHECK (department IN ('operations', 'customer_care', 'finance', 'growth', 'admin')),
  what TEXT NOT NULL CHECK (length(what) BETWEEN 1 AND 200),
  person_id TEXT REFERENCES people (id),
  city TEXT,
  due_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  done_at TEXT,
  done_by TEXT
);

-- The board reads each department's open tasks; erasure finds a client's.
CREATE INDEX staff_tasks_open ON staff_tasks (department, created_at) WHERE done_at IS NULL;
CREATE INDEX staff_tasks_by_person ON staff_tasks (person_id) WHERE person_id IS NOT NULL;
