-- Migration number: 0008
-- The client's profile (docs/decisions/0042-client-profile.md): the address a
-- visit goes to, a change of mobile number, and a request to delete the
-- account. Only new tables and a new nullable column, so the code already
-- deployed is unaffected.

-- One row per address a client has given; the current one has replaced_at NULL.
-- Earlier ones are kept, so a visit booked to an old address can still be read.
CREATE TABLE addresses (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  created_at TEXT NOT NULL,
  line1 TEXT NOT NULL,
  line2 TEXT,
  locality TEXT NOT NULL,
  city TEXT NOT NULL,
  pincode TEXT NOT NULL CHECK (length(pincode) = 6),
  -- "Gate code 4417 · park in visitor bay B": for the technician, from the day before the visit.
  access_notes TEXT,
  -- Filled once a geocoder is chosen (plan input 16), for the check-in's distance (P2-M4).
  lat REAL,
  lng REAL,
  geocoded_at TEXT,
  replaced_at TEXT
);

CREATE INDEX addresses_by_person ON addresses (person_id, replaced_at);

-- "A code goes to both numbers. The change then waits for ops to confirm, and
-- takes effect only after that confirmation."
CREATE TABLE number_change_requests (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  created_at TEXT NOT NULL,
  new_mobile_e164 TEXT NOT NULL,
  old_verified_at TEXT,
  new_verified_at TEXT,
  state TEXT NOT NULL CHECK (state IN ('verifying', 'awaiting_ops', 'confirmed', 'rejected', 'withdrawn')),
  decided_at TEXT,
  -- The member of staff who decided, by their Access e-mail.
  decided_by TEXT,
  reason TEXT
);

CREATE INDEX number_change_requests_by_state ON number_change_requests (state, created_at);
CREATE INDEX number_change_requests_by_person ON number_change_requests (person_id, created_at);

-- Which number change a code belongs to, for its two challenges.
ALTER TABLE otp_challenges ADD COLUMN number_change_id TEXT REFERENCES number_change_requests (id);

CREATE TABLE deletion_requests (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  created_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('requested', 'done', 'rejected')),
  decided_at TEXT,
  decided_by TEXT,
  reason TEXT
);

CREATE INDEX deletion_requests_by_state ON deletion_requests (state, created_at);
