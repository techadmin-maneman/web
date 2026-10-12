-- Remedies Customer Care give a client (docs/decisions/0143-remedies.md): free service visits with why, given at once
-- within the limit ops set, or awaiting a Customer Care manager above it. A given remedy is a grant in credit_ledger.
CREATE TABLE remedies (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  visits INTEGER NOT NULL CHECK (visits > 0),
  reason TEXT NOT NULL CHECK (reason IN ('fit_problem', 'technician_late', 'visit_missed', 'product_fault', 'other')),
  -- Care's words about it; NULL once the client is erased.
  note TEXT,
  given_by TEXT NOT NULL,
  given_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('given', 'awaiting', 'declined')),
  decided_by TEXT,
  decided_at TEXT
);

CREATE INDEX remedies_by_person ON remedies (person_id, given_at);
CREATE INDEX remedies_awaiting ON remedies (given_at) WHERE state = 'awaiting';
