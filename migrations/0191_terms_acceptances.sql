-- Migration number: 0191
-- Each "I agree to the Terms and Conditions and the Privacy Policy" a person ticks when they book: the versions they
-- agreed to, where, and when, kept as the record of the contract (src/domain/privacy/terms-acceptances.ts). Only a new
-- table, which refuses a change or a delete as consents do: the Worker already deployed writes and reads nothing of it.

CREATE TABLE terms_acceptances (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  terms_version TEXT NOT NULL CHECK (length(terms_version) BETWEEN 1 AND 16),
  privacy_version TEXT NOT NULL CHECK (length(privacy_version) BETWEEN 1 AND 16),
  source TEXT NOT NULL CHECK (source IN ('site_booking', 'referral_landing', 'app_booking')),
  -- A one-way hash of the network address it was given from, as a consent keeps.
  ip_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX terms_acceptances_person ON terms_acceptances (person_id, created_at);

CREATE TRIGGER terms_acceptances_no_update
BEFORE UPDATE ON terms_acceptances
BEGIN
  SELECT RAISE(ABORT, 'terms acceptances are append-only');
END;

CREATE TRIGGER terms_acceptances_no_delete
BEFORE DELETE ON terms_acceptances
BEGIN
  SELECT RAISE(ABORT, 'terms acceptances are append-only');
END;
