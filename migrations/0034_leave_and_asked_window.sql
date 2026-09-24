-- Migration number: 0034
-- Two gaps on the dispatch board: leave, and what the client asked for
-- (docs/open-points.md, "Leave on the dispatch board" and "The asked and the
-- offered window"; ADRs 0062 and 0063).
--
-- Only a new table and new columns, so the code already deployed is unaffected.

-- A technician's leave, in whole days of India's calendar. FSM has nowhere we
-- can put this: its Time_Off module exists but takes a Time_Off_Type whose list
-- lives in FSM's Setup screens, which the API does not reach, so no leave can be
-- written or read there today (ADR 0062). Ops record it in the console instead,
-- and the clash check reads it beside slot_claims, so booking and dispatch
-- refuse the same days without a second rule (ADR 0034).
CREATE TABLE technician_leave (
  id TEXT PRIMARY KEY,
  technician_id TEXT NOT NULL REFERENCES technicians (id),
  -- Inclusive, both of them: a single day's leave has the same date twice.
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  -- Why, in ops' own words, for whoever reads the board later. Never a medical detail.
  note TEXT,
  -- The Access identity of the ops user who recorded it, and of whoever took it back (ADR 0031).
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancelled_by TEXT,
  CHECK (to_date >= from_date)
);

CREATE INDEX technician_leave_by_technician ON technician_leave (technician_id, from_date);

-- The window the client asked for, as against the one the visit was given.
-- FSM holds one time on an appointment and its own Preference subform is
-- read-only there, so the asked window is read from the Request the visit's
-- work order names, and matched to the lead we wrote that Request from
-- (ADR 0063). NULL means nothing recorded one, and the board says so in words.
ALTER TABLE appointments ADD COLUMN asked_window TEXT CHECK (
  asked_window IN ('morning', 'afternoon', 'evening')
);

-- When the pass last looked, so a visit with no Request behind it — everything
-- our own booking creates — is not asked about again on every run.
ALTER TABLE appointments ADD COLUMN asked_checked_at TEXT;
