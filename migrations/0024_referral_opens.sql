-- Migration number: 0024
-- How many times an invite was opened (docs/decisions/0048-referrals.md): ops' funnel counts them. A plain
-- counter, not a ledger: it is a figure for ops, never money. Only a new column, so the code already deployed
-- is unaffected.

ALTER TABLE referral_codes ADD COLUMN opens INTEGER NOT NULL DEFAULT 0;
