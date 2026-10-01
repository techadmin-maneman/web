-- Migration number: 0061
-- A consultation and fit in one visit (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md; the owner's
-- ruling D2 of 1 October 2026). The visit is a first fit marked as one, booked from the site with nothing paid; the
-- client chooses the product with the technician, and pays by a Razorpay payment link once fitted.
--
-- New columns, each empty or 0 on every row there is, and a new table: the Worker already deployed reads none of
-- them, and every hold, visit and request it writes is no one visit, which is what their defaults say.

-- A hold the site's form made for a consultation and fit in one visit: a first fit, sold with nothing paid.
ALTER TABLE slot_holds ADD COLUMN one_visit INTEGER NOT NULL DEFAULT 0 CHECK (one_visit IN (0, 1));

-- Where a visit booked as one stands: booked until the technician closes it, then fitted, the client having chosen
-- a product and been fitted, or declined, the client having decided against it, when the visit is a consultation.
-- NULL for every other visit. The mirror keeps a fitted visit's product and a declined visit's kind, which FSM's item
-- does not say (src/domain/fsm-mirror.ts).
ALTER TABLE appointments ADD COLUMN one_visit TEXT CHECK (one_visit IN ('booked', 'fitted', 'declined'));

-- A consultation and fit in one visit asked for while self-serve booking is off, which ops book by hand.
ALTER TABLE consultation_requests ADD COLUMN one_visit INTEGER NOT NULL DEFAULT 0 CHECK (one_visit IN (0, 1));

-- The Razorpay payment link a one visit's client pays by, once fitted: one a visit, for the product chosen at its
-- price in the price book on the visit's day. Made when the technician closes the visit as done.
CREATE TABLE payment_links (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments (id),
  -- The first fit's service the client chose, by its tier.
  tier TEXT NOT NULL,
  -- In paise: the price with GST, and its parts, as the price book gave them.
  amount INTEGER NOT NULL,
  amount_ex_gst INTEGER NOT NULL,
  gst_percent INTEGER NOT NULL,
  -- Razorpay's link and its address, once Razorpay has made it and sent it to the client; NULL until then.
  razorpay_link_id TEXT UNIQUE,
  short_url TEXT,
  sent_at TEXT,
  -- The payment that paid it, once Razorpay's webhook says so.
  razorpay_payment_id TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The Tasks board reads the links still unpaid, however many have been paid.
CREATE INDEX payment_links_unpaid ON payment_links (created_at) WHERE paid_at IS NULL;
