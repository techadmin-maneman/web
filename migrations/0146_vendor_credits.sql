-- Vendor credits in Zoho Books (docs/decisions/0171-vendor-credits.md): each claim settled as a credit made a vendor
-- credit on its supplier's vendor, once, tried again an hour after a failure.
ALTER TABLE supplier_claims ADD COLUMN books_credit_id TEXT;
ALTER TABLE supplier_claims ADD COLUMN books_checked_at TEXT;

CREATE INDEX supplier_claims_to_credit ON supplier_claims (decided_at) WHERE outcome = 'credit' AND books_credit_id IS NULL;
