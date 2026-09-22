-- Migration number: 0019
-- Payments and refunds recorded in Zoho Books, so Books issues their receipts
-- (docs/decisions/0044-payments-mirror.md, "Receipts in Books"). Each ID marks
-- the record as written once; applied_at marks a payment set against its
-- visit's invoice; checked_at, when a record was last found not ready (its
-- client not yet in Books, its invoice still a draft) or refused, so it waits
-- an hour before Books is asked again. Only new columns, so the code already
-- deployed is unaffected.

ALTER TABLE payments ADD COLUMN books_payment_id TEXT;
ALTER TABLE payments ADD COLUMN books_checked_at TEXT;
ALTER TABLE payments ADD COLUMN books_applied_at TEXT;
ALTER TABLE refunds ADD COLUMN books_refund_id TEXT;
ALTER TABLE refunds ADD COLUMN books_checked_at TEXT;
