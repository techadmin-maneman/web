-- Migration number: 0085
-- When the cron last asked Razorpay about a payment its webhook may never have told us of
-- (src/domain/razorpay-catch-up.ts): a hold's order or link, and a one visit's link. Each is asked at most once an
-- hour.
--
-- Expand only: two nullable columns and an index. The Worker already deployed reads none of them.

ALTER TABLE slot_holds ADD COLUMN payment_checked_at TEXT;
ALTER TABLE payment_links ADD COLUMN payment_checked_at TEXT;

-- The cron reads the holds never confirmed that ran out in the last three days, or have yet to.
CREATE INDEX slot_holds_unconfirmed ON slot_holds (expires_at) WHERE confirmed_at IS NULL;
