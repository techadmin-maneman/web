-- Migration number: 0020
-- A client moving or cancelling a visit (docs/decisions/0046-moving-and-cancelling.md).
-- Only new columns and a new table, so the code already deployed is unaffected.

-- A hold made to move a visit: which visit, and whether it moves in place
-- ('move': free, or once its late fee is paid) or is replaced by a new visit
-- ('replace': a service visit moved inside 24 hours, the old one charged).
ALTER TABLE slot_holds ADD COLUMN moves_appointment_id TEXT REFERENCES appointments (id);
ALTER TABLE slot_holds ADD COLUMN move_kind TEXT CHECK (move_kind IN ('move', 'replace'));

-- What a payment paid for: the visit, or a late fee for moving it.
ALTER TABLE payments ADD COLUMN kind TEXT NOT NULL DEFAULT 'visit' CHECK (kind IN ('visit', 'late_fee'));

-- Each change a client made, with its notice and what it cost: the evidence a
-- charge shows ("cancelled 9:14 am, visit was 10 am").
CREATE TABLE visit_changes (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments (id),
  person_id TEXT NOT NULL REFERENCES people (id),
  -- moved: the same visit at a new time; replaced: cancelled for a new visit; cancelled.
  kind TEXT NOT NULL CHECK (kind IN ('moved', 'replaced', 'cancelled')),
  notice TEXT NOT NULL CHECK (notice IN ('free', 'late')),
  -- When the visit was to start, and, for a move, when it starts now.
  was_start TEXT NOT NULL,
  now_start TEXT,
  -- In paise: what goes back to the client, and what is kept as a charge.
  refund_amount INTEGER NOT NULL DEFAULT 0,
  kept_amount INTEGER NOT NULL DEFAULT 0,
  -- The payment refunded or kept, and Razorpay's refund once asked for.
  payment_id TEXT REFERENCES payments (id),
  razorpay_refund_id TEXT,
  hold_id TEXT REFERENCES slot_holds (id),
  created_at TEXT NOT NULL
);

CREATE INDEX visit_changes_by_appointment ON visit_changes (appointment_id, created_at);
-- A visit is cancelled once, so its refund is asked for once.
CREATE UNIQUE INDEX visit_changes_one_end ON visit_changes (appointment_id) WHERE kind IN ('replaced', 'cancelled');
