-- Migration number: 0079
--
-- The number a client's login challenge was asked for, so that a code sent
-- again on it counts against that number's day, whether or not anyone here
-- holds the number. The code already deployed does not read the new column.

-- The number, only as the rate limits key it: HMAC-SHA256 of "mobile:<E.164>" under IP_HASH_SALT.
ALTER TABLE otp_challenges ADD COLUMN mobile_hash TEXT;
