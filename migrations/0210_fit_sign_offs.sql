-- Migration number: 0210
-- The client signs off a fit (docs/decisions/0254-client-signs-off-the-fit.md): a first fit, a consultation and fit in
-- one visit that fitted, and a replacement are closed done only once the client has signed off, in their app or on the
-- technician's phone, or the technician has recorded that the client declined to sign, with why. One row a visit, as it
-- stands now. A new table: the Worker already deployed reads and writes none of it.

CREATE TABLE fit_sign_offs (
  appointment_id TEXT PRIMARY KEY REFERENCES appointments (id),
  -- asked: waiting for the client; signed: they are happy with the fit; flagged: something isn't right, which the
  -- technician puts right and asks again; declined: the technician closed without it, with why.
  state TEXT NOT NULL CHECK (state IN ('asked', 'signed', 'flagged', 'declined')),
  -- The client's three checks as they last answered them, a JSON object of booleans: hairline, blend, secure.
  checks TEXT,
  -- What the client said isn't right, in their words.
  flag_text TEXT CHECK (flag_text IS NULL OR length(flag_text) <= 500),
  -- Why the technician closed without it.
  declined_reason TEXT CHECK (declined_reason IS NULL OR length(declined_reason) <= 300),
  asked_at TEXT NOT NULL,
  -- How many times it has been asked: again after each flag.
  asks INTEGER NOT NULL DEFAULT 1,
  signed_at TEXT,
  signed_on TEXT CHECK (signed_on IS NULL OR signed_on IN ('client_app', 'technician_phone')),
  -- The one-time code a signature on the technician's phone carries, as its SHA-256; cleared once used.
  phone_code_hash TEXT,
  phone_code_expires_at TEXT,
  technician_id TEXT REFERENCES technicians (id),
  updated_at TEXT NOT NULL,
  CHECK ((state = 'signed') = (signed_at IS NOT NULL)),
  CHECK ((state = 'declined') = (declined_reason IS NOT NULL))
);

-- The Tasks queue of fits closed without a sign-off reads the declined ones (src/domain/ops/task-queues.ts).
CREATE INDEX fit_sign_offs_declined ON fit_sign_offs (updated_at) WHERE state = 'declined';

-- backfill: none. A fit closed before this migration closed under the rules then.
