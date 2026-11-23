-- A payment link as the client is sent it on WhatsApp: a random token our own address, maneman.in/pay/<token>, sends on
-- to Razorpay's link while it is open (docs/decisions/0300-payment-links-on-whatsapp.md). What it pays for is named by
-- its subject: a held booking, a custom order or a one visit's charge; sending it again sends the same token.
-- backfill: none. A new table; links made before it go by SMS alone, as they did.

CREATE TABLE pay_links (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('hold', 'custom_order', 'payment_link')),
  subject_id TEXT NOT NULL,
  url TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  what TEXT NOT NULL,
  open_until TEXT NOT NULL,
  made_at TEXT NOT NULL
);

CREATE INDEX pay_links_by_subject ON pay_links (subject_kind, subject_id, made_at);
CREATE INDEX pay_links_by_person ON pay_links (person_id);
