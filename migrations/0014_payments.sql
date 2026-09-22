-- Migration number: 0014
-- Payments, as Razorpay reports them to its webhook
-- (docs/decisions/0044-payments-mirror.md). Razorpay is the record of what was
-- paid and refunded; these rows follow its signed events. No card data is
-- ever held; a UPI handle only as a keyed hash, for the fraud rules. Only new
-- tables, so the code already deployed is unaffected.

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  -- Ours, for the client and ops: "MM-2026-0841", numbered by year once the payment is captured.
  reference TEXT UNIQUE,
  reference_year INTEGER,
  reference_number INTEGER,
  -- From the order's notes when we made the order; else the payment's mobile number matched to a person.
  person_id TEXT REFERENCES people (id),
  appointment_id TEXT REFERENCES appointments (id),
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT NOT NULL UNIQUE,
  -- In paise.
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  -- upi, card, netbanking, wallet and so on, as Razorpay names them.
  method TEXT,
  -- HMAC of the lower-cased UPI handle under IP_HASH_SALT: compared, never shown.
  vpa_hash TEXT,
  card_network TEXT,
  status TEXT NOT NULL CHECK (status IN ('authorized', 'captured', 'failed', 'refunded', 'partially_refunded')),
  -- In paise; refunds that Razorpay has processed.
  refunded_amount INTEGER NOT NULL DEFAULT 0,
  captured_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (reference_year, reference_number)
);

CREATE INDEX payments_by_person ON payments (person_id, created_at);

CREATE TABLE refunds (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments (id),
  razorpay_refund_id TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('created', 'processed', 'failed')),
  -- normal or optimum, as asked; Razorpay reports the speed it used.
  speed TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT,
  updated_at TEXT NOT NULL
);

-- Each Razorpay event once. Razorpay delivers at least once and not in order;
-- x-razorpay-event-id says which deliveries are the same event.
CREATE TABLE razorpay_events (
  event_id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  received_at TEXT NOT NULL
);
