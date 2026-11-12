-- Migration number: 0210
-- The client signs off a fit (docs/decisions/0254-client-signs-off-the-fit.md): a first fit, a one visit that fitted
-- and a replacement close done only once the client has signed off, or their decline is recorded with why. One row a
-- visit, as it stands now. A new table: the Worker already deployed reads and writes none of it.

CREATE TABLE fit_sign_offs (
  appointment_id TEXT PRIMARY KEY REFERENCES appointments (id),
  -- asked: waiting for the client; signed: they are happy with the fit; flagged: something isn't right, which the
  -- technician puts right and asks again; declined: the technician closed without it, with why.
  state TEXT NOT NULL CHECK (state IN ('asked', 'signed', 'flagged', 'declined')),
  -- The client's three checks as they last answered them, a JSON object of booleans: hairline, blend, secure.
  checks TEXT,
  -- What the client last said isn't right, in their words, kept once they sign.
  flag_text TEXT CHECK (flag_text IS NULL OR length(flag_text) <= 500),
  -- Why the technician closed without it.
  declined_reason TEXT CHECK (declined_reason IS NULL OR length(declined_reason) <= 300),
  asked_at TEXT NOT NULL,
  -- How many times it has been asked: again after each flag.
  asks INTEGER NOT NULL DEFAULT 1,
  signed_at TEXT,
  signed_on TEXT CHECK (signed_on IS NULL OR signed_on IN ('client_app', 'technician_phone')),
  -- The phone's events the latest ask and the answer on the technician's phone came with, so each sent again is
  -- answered as it was.
  ask_event_id TEXT,
  answer_event_id TEXT,
  -- The fit guarantee's days in force when it was signed or declined, which a first fit's guarantee runs for, whatever
  -- ops set since (docs/decisions/0256-fit-guarantee-setting.md).
  guarantee_days INTEGER,
  technician_id TEXT REFERENCES technicians (id),
  updated_at TEXT NOT NULL,
  CHECK ((state = 'signed') = (signed_at IS NOT NULL)),
  CHECK ((state = 'declined') = (declined_reason IS NOT NULL))
);

-- The Tasks queues of fits closed without a sign-off, and signed on the technician's phone, read these
-- (src/domain/ops/task-queues.ts).
CREATE INDEX fit_sign_offs_declined ON fit_sign_offs (updated_at) WHERE state = 'declined';
CREATE INDEX fit_sign_offs_on_phone ON fit_sign_offs (updated_at) WHERE signed_on = 'technician_phone';

-- backfill: none. A fit closed before this migration closed under the rules then.
