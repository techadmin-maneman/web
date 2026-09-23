-- Migration number: 0025
-- contract: docs/decisions/0051-booking-from-the-site.md
-- A Phase 2 booking is a lead too (docs/decisions/0051-booking-from-the-site.md).
--
-- The public page and the referral landing now book a real visit: a pincode, a
-- date and a window, with the slot held while the person fills the form. Those
-- forms do not ask the two things Phase 1's form asked for, so both columns
-- become optional:
--
--   loss_extent          the invited friend is never asked where the hair loss is;
--   first_choice_window  a booking has a date and a window of its own.
--
-- SQLite cannot drop NOT NULL in place, so the table is rebuilt. Nothing else
-- changes: the same columns, checks, defaults and indexes, and every row is
-- carried across. The rebuilt table must carry every column the table has
-- **today**, not only the ones migration 0002 gave it: 0015 added
-- fsm_request_id, and leaving it out took the FSM lead sync with it.

CREATE TABLE leads_rebuilt (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  created_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('form', 'waitlist', 'tryon')),
  city TEXT REFERENCES cities (name),
  first_choice_window TEXT CHECK (first_choice_window IN ('weekday_am', 'weekday_pm', 'weekend_am', 'weekend_pm')),
  loss_extent TEXT CHECK (loss_extent IN ('crown', 'receding', 'advanced')),
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
  request_id TEXT NOT NULL,
  -- Added by migration 0015: the FSM Request this lead became.
  fsm_request_id TEXT
);

INSERT INTO leads_rebuilt
SELECT
  id,
  person_id,
  created_at,
  source,
  city,
  first_choice_window,
  loss_extent,
  proposed_visit_date,
  utm_source,
  utm_medium,
  utm_campaign,
  utm_content,
  gclid,
  fbclid,
  referrer,
  landing_path,
  sync_state,
  sync_attempts,
  last_sync_error,
  synced_at,
  request_id,
  fsm_request_id
FROM leads;

DROP TABLE leads;

ALTER TABLE leads_rebuilt RENAME TO leads;

CREATE INDEX leads_by_sync_state ON leads (sync_state, created_at);
CREATE INDEX leads_by_person ON leads (person_id);
