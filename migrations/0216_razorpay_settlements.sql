-- Migration number: 0216
-- Razorpay's settlements to the bank (docs/decisions/0261-razorpay-money-in-books.md): each payout heard from Razorpay,
-- by its webhook or the hourly catch-up, and its two Books entries once recorded: the transfer to the bank, and the
-- fee as an expense. A new table: the Worker already deployed reads and writes none of it.

CREATE TABLE razorpay_settlements (
  -- Razorpay's ID, setl_…
  id TEXT PRIMARY KEY,
  -- Paise: what reached the bank, and Razorpay's fee taken out of it, the GST in that fee within it.
  amount INTEGER NOT NULL CHECK (amount >= 0),
  fees INTEGER NOT NULL CHECK (fees >= 0),
  tax INTEGER NOT NULL CHECK (tax >= 0 AND tax <= fees),
  -- The bank's reference for the payout, which its line in the bank feed carries.
  utr TEXT,
  settled_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  books_transfer_id TEXT,
  books_fee_id TEXT,
  -- When the Books pass last claimed it, so two passes record it once.
  books_checked_at TEXT
);

-- The settlements still owing a Books entry, which each Books pass reads.
CREATE INDEX razorpay_settlements_to_record ON razorpay_settlements (settled_at)
  WHERE books_transfer_id IS NULL OR (books_fee_id IS NULL AND fees > 0);

-- The invoice Books raised for the charge a payment kept (src/domain/books/books-kept.ts), so a refund reaching into it
-- can name the invoice to free the payment from, and staging's clean-up can find it.
ALTER TABLE payments ADD COLUMN books_kept_invoice_id TEXT;

-- backfill: none. No settlement was kept, nor kept charge invoiced, before this migration.
