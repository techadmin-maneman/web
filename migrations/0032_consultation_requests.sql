-- Migration number: 0032
--
-- A consultation asked for while self-serve booking is off
-- (docs/decisions/0060-an-invited-friend-reaches-ops-and-the-crm.md). The friend
-- picked a day and a window, and no slot is held for them: ops fix the hour on
-- WhatsApp and put the visit in FSM. Until they do, this is the only record of
-- what was asked for.
--
-- It points at people and at referral_codes, and not at leads: another table
-- pointing at leads would narrow what a later migration may do to that table,
-- which is what stopped migration 0025. The person is the link to their lead.

CREATE TABLE consultation_requests (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  pincode TEXT NOT NULL,
  -- The day and window they asked for, in the landing's own three windows.
  requested_date TEXT NOT NULL,
  requested_window TEXT NOT NULL CHECK (requested_window IN ('morning', 'afternoon', 'evening')),
  -- The invite they arrived with, where there was one.
  referral_code TEXT REFERENCES referral_codes (code),
  created_at TEXT NOT NULL,
  -- Asking twice for the same day and window is the same request.
  UNIQUE (person_id, requested_date, requested_window)
);

CREATE INDEX consultation_requests_by_created ON consultation_requests (created_at);
