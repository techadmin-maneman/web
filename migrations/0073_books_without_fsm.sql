-- Migration number: 0073
-- Without FSM, the Books pass makes each client's Books customer itself, and the
-- invoice pass bills a finished visit that has no FSM work order. Only a new
-- column and a new index, so the code already deployed is unaffected.

-- When the Books pass last tried to make the person's customer: one it could not
-- make waits an hour before it is tried again.
ALTER TABLE people ADD COLUMN books_checked_at TEXT;

-- The invoice pass: finished visits whose invoice is not yet issued, with or
-- without an FSM work order. appointments_to_invoice serves FSM's path until it goes.
CREATE INDEX appointments_to_bill ON appointments (window_start)
  WHERE status = 'completed' AND invoice_issued_at IS NULL AND deleted_at IS NULL;
