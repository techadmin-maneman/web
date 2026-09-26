-- Migration number: 0043
-- contract: docs/decisions/0073-hand-offs-and-messages.md
-- Hand-offs between surfaces, and the messages people are owed
-- (docs/decisions/0073-hand-offs-and-messages.md).

-- A visit the technician closed as a no-show is recorded as one, not as a
-- partial visit whose reason happens to say so (src/domain/fsm-mirror.ts).
-- The outcome's CHECK cannot change in place, so visits is rebuilt: nothing
-- points at it, so dropping it disturbs no reference (docs/migrations.md), and
-- every row is copied, a partial visit whose reason was a no-show becoming one.
-- The Worker already deployed still writes 'partial' with the reason
-- 'no_show', which the new CHECK takes; the next sync of that visit makes it a
-- no-show. It reads the outcome only to show it, and shows nothing for a word
-- it does not know, for the minutes until this release is live.
CREATE TABLE visits_next (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments (id),
  started_at TEXT,
  ended_at TEXT,
  duration_minutes INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN ('done', 'partial', 'no_show')),
  -- From the technician's outcome, for a partial visit only (src/config/job-sheet.ts).
  partial_reason TEXT,
  updated_at TEXT NOT NULL
);

INSERT INTO visits_next (id, appointment_id, started_at, ended_at, duration_minutes, outcome, partial_reason,
  updated_at)
SELECT id, appointment_id, started_at, ended_at, duration_minutes,
  CASE WHEN outcome = 'partial' AND partial_reason = 'no_show' THEN 'no_show' ELSE outcome END,
  CASE WHEN partial_reason = 'no_show' THEN NULL ELSE partial_reason END,
  updated_at
FROM visits;

DROP TABLE visits;

ALTER TABLE visits_next RENAME TO visits;

-- A visit left partly done is a task until the client has another booked
-- (src/domain/tasks.ts); the Tasks board reads only those.
CREATE INDEX visits_partial ON visits (appointment_id) WHERE outcome = 'partial';

-- One arrival notice a visit, however often the technician checks in: the
-- no-show's evidence reads its receipt (src/domain/visit-messages.ts).
CREATE UNIQUE INDEX outbound_messages_one_arrival ON outbound_messages (subject_id) WHERE kind = 'arrival_notice';

-- A visit's no-show, which its page and the client's Payments now say
-- (src/domain/no-shows.ts), found by the visit.
CREATE INDEX no_show_cases_by_appointment ON no_show_cases (appointment_id, created_at);

-- The client's note on a visit to come, from the app's "Add a note", which the
-- technician reads on the client's card (src/domain/client-notes.ts). The
-- latest replaces any before it. Blanked when the client is erased.
ALTER TABLE appointments ADD COLUMN client_note TEXT;
ALTER TABLE appointments ADD COLUMN client_note_at TEXT;

-- When a visit first reached our records, from a booking or from FSM, which
-- the address it still needs waits from on the Tasks board (src/domain/tasks.ts).
-- Written once, on insert. A visit the Worker already deployed writes has none,
-- and waits from when it was last synced instead.
ALTER TABLE appointments ADD COLUMN first_seen_at TEXT;

-- The friend's first name, kept with the referral when it is granted, so the
-- referrer's tracker still reads it after the friend is erased rather than
-- "Erased" (src/routes/client-refer.ts). Filled here for the grants already
-- made to a friend not erased; one erased before now has no name to keep.
ALTER TABLE referral_attributions ADD COLUMN friend_first_name TEXT;
UPDATE referral_attributions
SET friend_first_name = (
  SELECT CASE WHEN instr(trim(p.name), ' ') > 0 THEN substr(trim(p.name), 1, instr(trim(p.name), ' ') - 1)
    ELSE trim(p.name) END
  FROM people p WHERE p.id = referral_attributions.referred_person_id AND p.erased_at IS NULL)
WHERE grant_state IN ('granted', 'approved');
