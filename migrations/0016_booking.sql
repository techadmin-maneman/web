-- Migration number: 0016
-- Self-serve booking (docs/decisions/0045-self-serve-booking.md): the price
-- book, slots held while a client pays, and the claims that stop two visits
-- taking one technician's time (docs/decisions/0034-clash-check.md). Only new
-- tables, so the code already deployed is unaffected.

-- The only source of prices for the app and the referral page. A new price is a
-- new row from its date; the old one stays for what was sold under it.
CREATE TABLE price_book (
  -- consultation, first_fit, service, replacement, late_fee_first_fit or late_fee_replacement.
  item TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'standard',
  -- In paise, before GST.
  amount_ex_gst INTEGER NOT NULL CHECK (amount_ex_gst >= 0),
  gst_percent INTEGER NOT NULL CHECK (gst_percent >= 0),
  -- India's calendar date it applies from.
  valid_from TEXT NOT NULL,
  PRIMARY KEY (item, tier, valid_from)
);

-- PLACEHOLDER prices and rate: the design's figures at 5%, until the owner sets
-- the price book and the CA the rates (docs/open-points.md, items 1 and 2).
INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES
  ('consultation', 'standard', 0, 0, '2026-01-01'),
  ('first_fit', 'standard', 3000000, 5, '2026-01-01'),
  ('service', 'standard', 200000, 5, '2026-01-01'),
  ('replacement', 'standard', 1500000, 5, '2026-01-01'),
  ('late_fee_first_fit', 'standard', 400000, 5, '2026-01-01'),
  ('late_fee_replacement', 'standard', 300000, 5, '2026-01-01');

-- A slot held for a client while they pay: ten minutes, as board C4 counts.
CREATE TABLE slot_holds (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  type TEXT NOT NULL CHECK (type IN ('consultation', 'first_fit', 'service', 'replacement')),
  -- India's calendar date, and the window booked on it.
  date TEXT NOT NULL,
  window_label TEXT NOT NULL CHECK (window_label IN ('morning', 'afternoon', 'evening')),
  technician_id TEXT NOT NULL REFERENCES technicians (id),
  -- The half-slot the visit starts in (src/config/scheduling.ts).
  start_unit INTEGER NOT NULL,
  -- The price when it was held, in paise: what the client pays, and its GST.
  amount INTEGER NOT NULL,
  amount_ex_gst INTEGER NOT NULL,
  gst_percent INTEGER NOT NULL,
  -- held: waiting to be paid; booked: paid (or free) and written to FSM; released: let go or expired unpaid.
  state TEXT NOT NULL CHECK (state IN ('held', 'booked', 'released')),
  razorpay_order_id TEXT UNIQUE,
  appointment_id TEXT REFERENCES appointments (id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX slot_holds_by_person ON slot_holds (person_id, created_at);

-- What a hold or a visit takes of a technician's day: each half-slot it covers
-- ("unit:3"), and the window it starts in ("window:afternoon"), since a
-- technician holds one live job per window. Written in one batch with the hold,
-- so two clients cannot take the same time.
CREATE TABLE slot_claims (
  technician_id TEXT NOT NULL REFERENCES technicians (id),
  date TEXT NOT NULL,
  claim TEXT NOT NULL,
  hold_id TEXT NOT NULL REFERENCES slot_holds (id),
  PRIMARY KEY (technician_id, date, claim)
);

CREATE INDEX slot_claims_by_hold ON slot_claims (hold_id);
