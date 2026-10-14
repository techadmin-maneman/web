-- The release that reads books_invoice_id and write_state, the second of ADR 0113's steps: what only the old columns
-- hold is copied across again, and the indexes on the old columns are made on the new. Both columns are still
-- written, so the Worker before this one reads what this one writes, and the old ones go two releases on.

-- backfill: no rows expected, since every Worker since 0104 writes both
UPDATE appointments SET books_invoice_id = fsm_invoice_id WHERE books_invoice_id IS NULL AND fsm_invoice_id IS NOT NULL;
UPDATE dispatch_moves SET write_state = fsm_write_state WHERE write_state IS NULL;
UPDATE job_events SET write_state = fsm_write_state WHERE write_state IS NULL;

-- The Tasks board's draft invoices: a finished visit whose invoice Books holds but has not sent.
CREATE INDEX appointments_drafts_held ON appointments (window_start)
  WHERE status = 'completed' AND invoice_issued_at IS NULL AND books_invoice_id IS NOT NULL AND deleted_at IS NULL;
-- One move of a visit waiting to be written at a time.
CREATE UNIQUE INDEX dispatch_moves_one_waiting ON dispatch_moves (appointment_id) WHERE write_state = 'pending';
-- A move written that its client may not have heard of, not yet recorded as a call.
CREATE INDEX dispatch_moves_not_told ON dispatch_moves (now_start) WHERE write_state = 'written' AND told_at IS NULL;
