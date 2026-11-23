-- A payment link as the client is sent it on WhatsApp: a random token our own address, maneman.in/pay/<token>, sends on
-- to Razorpay's link while it is open (docs/decisions/0300-payment-links-on-whatsapp.md). What it pays for is named by
-- its subject: a held booking, a custom order or a one visit's charge; sending it again sends the same token.
-- backfill: none. A new table, and two triggers made again; links made before it go by SMS alone, as they did.

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

-- The message is WhatsApp's alone, as the site's notices are: the client app's cards already show a held booking's and
-- a custom order's link, and no alert is written beside it. The two triggers of 0211 are made again leaving it out.
DROP TRIGGER client_app_alerts_beside_messages;
DROP TRIGGER client_app_alerts_beside_messages_ready;

CREATE TRIGGER client_app_alerts_beside_messages AFTER INSERT ON outbound_messages
WHEN NEW.state NOT IN ('skipped', 'waiting') AND NEW.kind NOT IN (
  'waitlist_confirmation', 'consultation_exists', 'book_in_app', 'address_on_account', 'address_not_served',
  'messages_stopped', 'payment_link'
)
BEGIN
  INSERT OR IGNORE INTO client_app_alerts (id, person_id, kind, subject_kind, subject_id, once_key, written_at)
  VALUES (lower(hex(randomblob(16))), NEW.person_id, NEW.kind, NEW.subject_kind, NEW.subject_id, 'message:' || NEW.id,
          NEW.created_at);
END;

CREATE TRIGGER client_app_alerts_beside_messages_ready AFTER UPDATE OF state ON outbound_messages
WHEN OLD.state = 'waiting' AND NEW.state = 'queued' AND NEW.kind NOT IN (
  'waitlist_confirmation', 'consultation_exists', 'book_in_app', 'address_on_account', 'address_not_served',
  'messages_stopped', 'payment_link'
)
BEGIN
  INSERT OR IGNORE INTO client_app_alerts (id, person_id, kind, subject_kind, subject_id, once_key, written_at)
  VALUES (lower(hex(randomblob(16))), NEW.person_id, NEW.kind, NEW.subject_kind, NEW.subject_id, 'message:' || NEW.id,
          NEW.queued_at);
END;
