-- Partners' monthly statements (docs/decisions/0124-partner-statements.md). A month's commission is what the friends
-- fitted that month earned, less what a refund under the guarantee took back that month; Finance pays it from the
-- payout tool and records the payment here, against its month.

-- When a refund took a friend's commission back, so the taking back falls in that month's statement.
ALTER TABLE channel_attributions ADD COLUMN clawed_back_at TEXT;

CREATE TABLE partner_payouts (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES referral_channels (id),
  -- The month paid for, "YYYY-MM", in India.
  month TEXT NOT NULL,
  -- Paise, as paid: what the month came to, or less where tax was deducted.
  amount INTEGER NOT NULL CHECK (amount >= 0),
  paid_on TEXT NOT NULL,
  -- The payout tool's reference for the transfer: a UTR, or a payout's ID.
  reference TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE (channel_id, month)
);

-- A month's fits and the commission taken back in it, read for every partner at once.
CREATE INDEX channel_attributions_by_granted ON channel_attributions (granted_at) WHERE granted_at IS NOT NULL;
CREATE INDEX channel_attributions_by_clawed_back ON channel_attributions (clawed_back_at)
  WHERE clawed_back_at IS NOT NULL;
