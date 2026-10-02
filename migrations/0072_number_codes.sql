-- Migration number: 0072
--
-- A WhatsApp code that proves a number typed into the site before a form acts
-- on it: the consultation and fit in one visit, and the try-on's gate. The code
-- already deployed reads neither the new table nor the new column.

CREATE TABLE number_codes (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  -- The number, only as the rate limits key it: HMAC-SHA256 of "mobile:<E.164>" under IP_HASH_SALT.
  mobile_hash TEXT NOT NULL,
  -- HMAC-SHA256 of the row's ID and its code, under OTP_PEPPER.
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  voided_at TEXT
);

CREATE INDEX number_codes_by_expiry ON number_codes (expires_at);

-- When the try-on's claim came with its number proved by a code. The app shows
-- and keeps a client's try-on only when it did.
ALTER TABLE tryon_jobs ADD COLUMN number_proved_at TEXT;
