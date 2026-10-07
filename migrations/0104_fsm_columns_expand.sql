-- Migration number: 0104
-- The two columns FSM named that are still in use, under names for what they hold now: a visit's Books invoice, and
-- whether our own write landed. Expand only (docs/decisions/0113-fsms-columns-go.md): the code writes both, every
-- read stays on the old columns, and the Worker already deployed writes the old ones alone.

ALTER TABLE appointments ADD COLUMN books_invoice_id TEXT;
ALTER TABLE dispatch_moves ADD COLUMN write_state TEXT CHECK (write_state IN ('pending', 'written', 'rejected'));
ALTER TABLE job_events ADD COLUMN write_state TEXT CHECK (write_state IN ('pending', 'written', 'rejected'));

UPDATE appointments SET books_invoice_id = fsm_invoice_id WHERE fsm_invoice_id IS NOT NULL;
-- backfill: about 100 rows x (1 + 4 indexes) on dispatch_moves, and about 1,000 x (1 + 3 indexes) on job_events
UPDATE dispatch_moves SET write_state = fsm_write_state;
UPDATE job_events SET write_state = fsm_write_state;
