-- Cycle counts (docs/decisions/0185-cycle-counts.md): each place counted a class at a time, never all at once. A task
-- is raised each morning for a place and class whose period has come round; the counter is never shown what the
-- ledger holds; a difference past the tolerance is counted again, and one that stands is signed off by a manager.

-- How often an item is counted wherever it is held; NULL for its kind's own: a hair system weekly, the rest quarterly.
ALTER TABLE consumables ADD COLUMN count_class TEXT CHECK (count_class IN ('weekly', 'monthly', 'quarterly'));

CREATE TABLE count_tasks (
  id TEXT PRIMARY KEY,
  -- No foreign key: a kit is deleted with a technician added by mistake (migration 0133), and reads leave its tasks out.
  place_id TEXT NOT NULL,
  count_class TEXT NOT NULL CHECK (count_class IN ('weekly', 'monthly', 'quarterly')),
  due_on TEXT NOT NULL,
  -- open until counted; recount while a difference waits to be counted again; sign_off while a recount that still
  -- differs waits for a manager; done once every line is settled.
  state TEXT NOT NULL CHECK (state IN ('open', 'recount', 'sign_off', 'done')),
  raised_at TEXT NOT NULL,
  counted_by TEXT,
  counted_at TEXT,
  recounted_by TEXT,
  recounted_at TEXT,
  signed_off_by TEXT,
  signed_off_at TEXT,
  sign_off_note TEXT,
  done_at TEXT
);

CREATE INDEX count_tasks_by_place ON count_tasks (place_id, count_class, due_on);
CREATE INDEX count_tasks_open ON count_tasks (place_id, count_class) WHERE state <> 'done';
CREATE INDEX count_tasks_done ON count_tasks (done_at) WHERE state = 'done';

-- What a place holds, read a place at a time: the items a count lists.
CREATE INDEX stock_balances_by_place ON stock_balances (place, consumable_code) WHERE quantity > 0;

CREATE TABLE count_lines (
  task_id TEXT NOT NULL REFERENCES count_tasks (id),
  consumable_code TEXT NOT NULL REFERENCES consumables (code),
  -- What the ledger held when the line was counted, which the counter never sees.
  held INTEGER NOT NULL,
  counted INTEGER NOT NULL,
  recounted INTEGER,
  -- settled once the ledger takes it; recount or sign_off while it waits.
  state TEXT NOT NULL CHECK (state IN ('settled', 'recount', 'sign_off')),
  PRIMARY KEY (task_id, consumable_code)
);
