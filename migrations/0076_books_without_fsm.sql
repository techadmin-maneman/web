-- Migration number: 0076
-- Without FSM, the Books pass makes each client's Books customer itself, and the
-- invoice pass bills a finished visit that has no FSM work order. Only a new
-- column and new indexes, so the code already deployed is unaffected.

-- When the Books pass last tried to make the person's customer: one it could not
-- make waits an hour before it is tried again.
ALTER TABLE people ADD COLUMN books_checked_at TEXT;

-- The invoice pass: finished visits sold for a price whose invoice is not yet
-- issued, with or without an FSM work order. A free consultation, or a one visit
-- the client declined, is never invoiced, so it is left out. appointments_to_invoice
-- serves FSM's path until it goes.
CREATE INDEX appointments_to_bill ON appointments (window_start)
  WHERE status = 'completed' AND invoice_issued_at IS NULL AND deleted_at IS NULL
    AND type IN ('first_fit', 'service', 'replacement') AND one_visit IS NOT 'declined';

-- The Tasks board's draft invoices: a finished visit whose invoice Books holds
-- but has not sent.
CREATE INDEX appointments_held_drafts ON appointments (window_start)
  WHERE status = 'completed' AND invoice_issued_at IS NULL AND fsm_invoice_id IS NOT NULL AND deleted_at IS NULL;
