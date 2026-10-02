-- Migration number: 0071
--
-- The photograph consents the pay step showed when the client tapped Pay, kept
-- on the hold and recorded only once the booking is confirmed, paid or free.
-- The code already deployed reads neither column.

-- The purposes shown, comma-separated, as "photos_own_record,photos_referral_cards".
ALTER TABLE slot_holds ADD COLUMN consents_shown TEXT;

-- The tapping client's hashed address, which the consent rows carry.
ALTER TABLE slot_holds ADD COLUMN consents_ip_hash TEXT;
