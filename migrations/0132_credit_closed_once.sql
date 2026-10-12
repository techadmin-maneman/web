-- A credit grant is closed once (docs/decisions/0033-credit-ledger.md): what is left of it expires, or is taken back
-- when its referral's first fit is refunded, and never both, so two passes over it at once write one entry.
CREATE UNIQUE INDEX credit_ledger_one_close ON credit_ledger (grant_id) WHERE kind IN ('expire', 'clawback');
