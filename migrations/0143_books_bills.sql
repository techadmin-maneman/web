-- Bills in Zoho Books (docs/decisions/0168-bills-in-books.md): each supplier with a receipt to bill made a Books vendor,
-- and each receipt a bill, once, each tried again an hour after a failure.
ALTER TABLE suppliers ADD COLUMN books_vendor_id TEXT;
ALTER TABLE suppliers ADD COLUMN books_checked_at TEXT;
ALTER TABLE receipts ADD COLUMN books_bill_id TEXT;
ALTER TABLE receipts ADD COLUMN books_checked_at TEXT;

CREATE INDEX receipts_to_bill ON receipts (received_at) WHERE books_bill_id IS NULL;
