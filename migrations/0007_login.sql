-- Migration number: 0007
-- Phase 2 login: the one-time codes a client logs in with, and the sessions
-- that follow (docs/decisions/0030-one-time-codes.md, 0029-sessions.md). Only
-- new tables, so the code already deployed is unaffected.
--
-- No code and no session token is stored, only their hashes.

CREATE TABLE otp_challenges (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  -- NULL for a number with no booking. Such a challenge answers exactly as a
  -- real one does, but nothing is sent and no code matches it, so the login
  -- screen never says whether a number has a booking.
  person_id TEXT REFERENCES people (id),
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'number_change_old', 'number_change_new')),
  -- The channel the current code went by.
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms')),
  -- HMAC-SHA256 of the challenge's ID and its code, under OTP_PEPPER. NULL for a challenge that sends nothing.
  code_hash TEXT,
  last_sent_at TEXT NOT NULL,
  sends INTEGER NOT NULL DEFAULT 1,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  voided_at TEXT
);

CREATE INDEX otp_challenges_by_person ON otp_challenges (person_id, created_at);
CREATE INDEX otp_challenges_by_expiry ON otp_challenges (expires_at);

CREATE TABLE sessions (
  -- SHA-256 of the cookie's token. The token itself is never stored.
  id TEXT PRIMARY KEY,
  -- A client (people.id) now; a technician from P2-M4.
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('client', 'technician')),
  subject_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  -- What the browser said it was at login, e.g. "Chrome on Android", for the profile's list of devices.
  device_label TEXT,
  revoked_at TEXT
);

CREATE INDEX sessions_by_subject ON sessions (subject_kind, subject_id);
CREATE INDEX sessions_by_expiry ON sessions (expires_at);
