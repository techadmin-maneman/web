-- Migration number: 0219
-- Why a hair system failed (docs/decisions/0273-why-a-hair-system-failed.md): the list ops keep, as not_fitted_reasons
-- is kept, and on a piece the code of the reason it failed for, beside the words already kept, so failures count by
-- reason after ops reword one. A new table and a new column: the Worker already deployed reads and writes neither.
CREATE TABLE failure_reasons (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  retired_at TEXT,
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL
);

ALTER TABLE pieces ADD COLUMN failure_code TEXT;
