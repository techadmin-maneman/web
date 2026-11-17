-- Migration number: 0218
-- Why a hair system could not be fitted today (docs/decisions/0270-the-design-checks-api-side.md): the list ops keep,
-- as lost_reasons is kept, and the reason the technician picked as "Can't fit today" closed the fit, by its code. A new
-- table and a new column: the Worker already deployed reads and writes neither.
CREATE TABLE not_fitted_reasons (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  retired_at TEXT,
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL
);

ALTER TABLE visit_outcomes ADD COLUMN not_fitted_reason TEXT;
