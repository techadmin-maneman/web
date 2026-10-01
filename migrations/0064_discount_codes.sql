-- Migration number: 0064
-- Discount codes (docs/decisions/0108-discount-codes.md; the owner's rulings of 1 October 2026). Ops generate codes
-- in the console, and the client, the technician or ops enter one on a booking before it is invoiced.
--
-- Two new tables, their indexes, two triggers on the second, and a column that is empty on every row there is: the
-- Worker already deployed reads none of them.

-- A code, as ops made it, and whether it is still on.
CREATE TABLE discount_codes (
  id TEXT PRIMARY KEY,
  -- In capitals, of the letters and digits none reads as another (src/policy/discount-codes.ts); matched whatever
  -- case it is entered in.
  code TEXT NOT NULL UNIQUE,
  -- percent: value is whole per cent, 1 to 100; amount: value is paise taken off before GST.
  kind TEXT NOT NULL CHECK (kind IN ('percent', 'amount')),
  value INTEGER NOT NULL CHECK (value > 0 AND (kind = 'amount' OR value <= 100)),
  -- The most a percent code takes off, in paise before GST; NULL for no cap, and always NULL for an amount.
  cap INTEGER CHECK (cap IS NULL OR (cap > 0 AND kind = 'percent')),
  -- The kinds of visit it takes money off, 1 for each: a one visit is a first fit.
  covers_first_fit INTEGER NOT NULL CHECK (covers_first_fit IN (0, 1)),
  covers_service INTEGER NOT NULL CHECK (covers_service IN (0, 1)),
  covers_replacement INTEGER NOT NULL CHECK (covers_replacement IN (0, 1)),
  -- The last day in India it may be entered; NULL for no end.
  expires_on TEXT,
  -- How many bookings it may be on; NULL for no limit.
  max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  once_per_client INTEGER NOT NULL CHECK (once_per_client IN (0, 1)),
  -- The codes generated with it in one press, as a batch of single-use codes is; NULL for a code made alone.
  batch_id TEXT,
  -- The Access identity that made it.
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- Switched off: no booking takes it from then on, and its uses stay as they are. NULL while it is on.
  switched_off_by TEXT,
  switched_off_at TEXT,
  CHECK (covers_first_fit + covers_service + covers_replacement > 0)
);

CREATE INDEX discount_codes_by_batch ON discount_codes (batch_id) WHERE batch_id IS NOT NULL;

-- Each time a code was entered on a booking. A use is never deleted: a code taken off a booking, or one whose hold
-- lapsed unpaid, keeps its row, marked removed or read as lapsed (src/domain/discount-codes.ts).
CREATE TABLE discount_code_uses (
  id TEXT PRIMARY KEY,
  code_id TEXT NOT NULL REFERENCES discount_codes (id),
  person_id TEXT NOT NULL REFERENCES people (id),
  -- The booking: the hold, for a code entered as the client books; the visit, for one entered after.
  hold_id TEXT REFERENCES slot_holds (id),
  appointment_id TEXT REFERENCES appointments (id),
  -- Paise taken off before GST; NULL until the price is known, as a one visit's is only once its product is chosen.
  amount_off INTEGER CHECK (amount_off IS NULL OR amount_off >= 0),
  given_by TEXT NOT NULL CHECK (given_by IN ('client', 'technician', 'ops')),
  -- The client's or the technician's ID, or the Access identity of ops.
  given_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- Taken off the booking before it was invoiced; NULL while it stands.
  removed_at TEXT,
  removed_by TEXT CHECK (removed_by IN ('client', 'technician', 'ops', 'system')),
  removed_by_id TEXT,
  CHECK (hold_id IS NOT NULL OR appointment_id IS NOT NULL)
);

-- One code per booking, however many have been taken off it.
CREATE UNIQUE INDEX discount_code_uses_one_per_hold ON discount_code_uses (hold_id)
  WHERE hold_id IS NOT NULL AND removed_at IS NULL;
CREATE UNIQUE INDEX discount_code_uses_one_per_visit ON discount_code_uses (appointment_id)
  WHERE appointment_id IS NOT NULL AND removed_at IS NULL;

-- A code's uses, and a client's of it, which its limits count.
CREATE INDEX discount_code_uses_by_code ON discount_code_uses (code_id, person_id);

-- A client's uses, which their page in the console and their data export read.
CREATE INDEX discount_code_uses_by_person ON discount_code_uses (person_id);

-- A booking's uses, removed or not, which the payment link and the invoice pass read by the hold or the visit.
CREATE INDEX discount_code_uses_by_hold ON discount_code_uses (hold_id) WHERE hold_id IS NOT NULL;
CREATE INDEX discount_code_uses_by_visit ON discount_code_uses (appointment_id) WHERE appointment_id IS NOT NULL;

CREATE TRIGGER discount_code_uses_kept BEFORE DELETE ON discount_code_uses
BEGIN
  SELECT RAISE(ABORT, 'a discount code''s uses stay on record');
END;

-- What a use says is written once: only its amount, while it has none, and its removal, once, may be added.
CREATE TRIGGER discount_code_uses_written_once BEFORE UPDATE ON discount_code_uses
WHEN OLD.code_id IS NOT NEW.code_id OR OLD.person_id IS NOT NEW.person_id OR OLD.hold_id IS NOT NEW.hold_id
  OR OLD.appointment_id IS NOT NEW.appointment_id OR OLD.given_by IS NOT NEW.given_by
  OR OLD.given_by_id IS NOT NEW.given_by_id OR OLD.created_at IS NOT NEW.created_at
  OR (OLD.amount_off IS NOT NULL AND OLD.amount_off IS NOT NEW.amount_off) OR OLD.removed_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a discount code''s use is kept as it was written');
END;

-- The code the site's form was given with a consultation and fit in one visit asked for while self-serve booking is
-- off, as it was typed and found to apply: ops enter it on the visit they book by hand, which the Tasks board says.
ALTER TABLE consultation_requests ADD COLUMN discount_code TEXT;
