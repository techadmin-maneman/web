-- Migration number: 0012
-- The FSM reconciliation's place (docs/decisions/0032-fsm-mirror.md). Every
-- five minutes it reads FSM's latest changes; overnight it walks the whole
-- appointment list a page at a time, and checks again any copy FSM did not
-- list. Only a new table and a new column, so the code already deployed is
-- unaffected.

CREATE TABLE sync_cursors (
  name TEXT PRIMARY KEY CHECK (name IN ('fsm_appointments')),
  -- The India date of the night whose full pass this is.
  pass_date TEXT,
  -- The next page the pass reads; 0 once tonight's pass is done.
  next_page INTEGER NOT NULL DEFAULT 1,
  pass_started_at TEXT,
  -- Copies this pass found missing or out of date, which the webhook should have kept.
  repaired INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- When the last full pass saw the appointment in FSM's list.
ALTER TABLE appointments ADD COLUMN reconciled_at TEXT;
