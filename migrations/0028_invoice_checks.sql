-- Migration number: 0028
-- When a finished job was last offered to FSM for invoicing (ADR 0054).
--
-- The five-minute pass bills every completed appointment whose invoice we do
-- not hold yet. A work order FSM will not invoice — a free consultation, or one
-- it refuses — would otherwise be offered again every five minutes for ever, so
-- each attempt is stamped here and the next one waits an hour, as the Books
-- pass does with books_checked_at. One new column, so deployed code is
-- unaffected.

ALTER TABLE appointments ADD COLUMN invoice_checked_at TEXT;
