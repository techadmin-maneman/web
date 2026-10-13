-- Migration number: 0161
-- What a no-show's ruling gives back, kept as owed in the ruling's batch: the request that ruled asks Razorpay at once,
-- and the cron's refund job asks for any it did not settle (src/domain/no-shows/after-a-ruling.ts).
--
-- A new table: the Worker already deployed writes nothing to it, and asks for its refunds as it did.

CREATE TABLE no_show_refunds (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments (id),
  -- What gives it back: a waiver, what a charge does not keep, or a dispute refunded. A ruling is made once, so each
  -- is owed once a visit.
  why TEXT NOT NULL CHECK (why IN ('waived', 'charged', 'refunded on dispute')),
  -- In paise, as ruled; what is refunded is at most what is left of the visit's payment then.
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL,
  -- When Razorpay was first asked, written before it is, so a second ask is made as one that may have been made.
  asked_at TEXT,
  -- When it was done with: refunded, or left to ops with an alert, or nothing left to give back.
  settled_at TEXT,
  razorpay_refund_id TEXT,
  UNIQUE (appointment_id, why)
);

-- The refunds still owed, oldest first, for the cron's refund job.
CREATE INDEX no_show_refunds_owed ON no_show_refunds (created_at) WHERE settled_at IS NULL;
