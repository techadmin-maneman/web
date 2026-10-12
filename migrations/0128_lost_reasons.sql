-- Why a client is not going ahead with a fit after their consultation (docs/decisions/0149-lost-reasons.md): the list
-- ops keep, as partial_reasons is kept, and the reason the technician picked as the consultation closed, by its code.
CREATE TABLE lost_reasons (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  retired_at TEXT,
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL
);

ALTER TABLE visits ADD COLUMN lost_reason TEXT;
