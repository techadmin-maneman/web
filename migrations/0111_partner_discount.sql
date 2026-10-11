-- A partner's discount code for the friends it sends (docs/decisions/0125-partner-discount-codes.md): one of Finance's
-- codes, which comes off the friend's first paid visit by itself, beside or instead of the partner's free visits.
ALTER TABLE referral_channels ADD COLUMN discount_code_id TEXT REFERENCES discount_codes (id);

-- Whether a partner names a code, which keeps the code from being deleted.
CREATE INDEX referral_channels_by_discount_code ON referral_channels (discount_code_id);
