-- Migration number: 0023
-- DPDP readiness (docs/decisions/0049-dpdp.md): an erased person's FSM contact is anonymised afterwards, like
-- their CRM record; a deletion request not yet processed alerts ops before its 7 days run out; and grievances
-- are kept until ops answer them. Only new columns and a new table, so the code already deployed is unaffected.

ALTER TABLE people ADD COLUMN fsm_erased_at TEXT;
ALTER TABLE people ADD COLUMN fsm_erasure_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE deletion_requests ADD COLUMN alerted_at TEXT;

CREATE TABLE grievances (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  -- The client's own words; blanked if they are erased.
  text TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'resolved')),
  response TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX grievances_by_state ON grievances (state, created_at);
