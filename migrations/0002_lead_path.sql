-- Migration number: 0002
-- The lead path: people, the cities we serve, leads and their consents, plus
-- the counters, idempotency records, Zoho token cache and event log that
-- support them. Try-on tables arrive in M3.
--
-- Times are ISO-8601 UTC strings. Booleans are 0 or 1. Mobile numbers are E.164.

-- One row per human, keyed by mobile number. D1 owns this identity; the Zoho
-- lead ID is only a reference.
CREATE TABLE people (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  mobile_e164 TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  zoho_lead_id TEXT,
  -- 1 only once a `contact` consent exists: ops may call and message.
  contactable INTEGER NOT NULL DEFAULT 0 CHECK (contactable IN (0, 1)),
  erased_at TEXT
);

-- The city list the booking form shows. Opening a city is an UPDATE, not a deploy.
CREATE TABLE cities (
  name TEXT PRIMARY KEY,
  served INTEGER NOT NULL CHECK (served IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort INTEGER NOT NULL
);

INSERT INTO cities (name, served, active, sort) VALUES
  ('Gurgaon', 1, 1, 10),
  ('Delhi', 1, 1, 20),
  ('Noida', 1, 1, 30),
  ('Faridabad', 1, 1, 40),
  ('Ghaziabad', 1, 1, 50),
  ('Mumbai', 0, 1, 60),
  ('Bengaluru', 0, 1, 70);

CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  created_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('form', 'waitlist', 'tryon')),
  city TEXT REFERENCES cities (name),
  first_choice_window TEXT CHECK (first_choice_window IN ('weekday_am', 'weekday_pm', 'weekend_am', 'weekend_pm')),
  loss_extent TEXT NOT NULL CHECK (loss_extent IN ('crown', 'receding', 'advanced')),
  proposed_visit_date TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  gclid TEXT,
  fbclid TEXT,
  referrer TEXT,
  landing_path TEXT,
  sync_state TEXT NOT NULL DEFAULT 'pending' CHECK (sync_state IN ('pending', 'synced', 'failed')),
  sync_attempts INTEGER NOT NULL DEFAULT 0,
  last_sync_error TEXT,
  synced_at TEXT,
  request_id TEXT NOT NULL
);

CREATE INDEX leads_by_sync_state ON leads (sync_state, created_at);
CREATE INDEX leads_by_person ON leads (person_id);

-- Append-only record of what each person agreed to, and under which notice text.
CREATE TABLE consents (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  purpose TEXT NOT NULL CHECK (purpose IN ('contact', 'tryon_photo', 'result_delivery')),
  notice_version TEXT NOT NULL,
  granted INTEGER NOT NULL CHECK (granted IN (0, 1)),
  created_at TEXT NOT NULL,
  ip_hash TEXT
);

CREATE INDEX consents_by_person ON consents (person_id);

CREATE TRIGGER consents_no_update
BEFORE UPDATE ON consents
BEGIN
  SELECT RAISE(ABORT, 'consents are append-only');
END;

CREATE TRIGGER consents_no_delete
BEFORE DELETE ON consents
BEGIN
  SELECT RAISE(ABORT, 'consents are append-only');
END;

-- Dates ops will not offer as a proposed visit.
CREATE TABLE visit_blackouts (
  date TEXT PRIMARY KEY,
  reason TEXT NOT NULL
);

-- Fixed-window counters for rate limits and daily ceilings.
CREATE TABLE counters (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, key, window_start)
);

-- A repeated request with the same Idempotency-Key gets the stored response.
-- response_json is NULL while the first request is still being processed.
CREATE TABLE idempotency (
  key TEXT NOT NULL,
  route TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (key, route)
);

-- The current Zoho access token (they last an hour).
CREATE TABLE zoho_token (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- What happened, for analysis. No personal data in payload_json.
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  name TEXT NOT NULL,
  subject_id TEXT,
  payload_json TEXT
);

CREATE INDEX events_by_name ON events (name, created_at);
