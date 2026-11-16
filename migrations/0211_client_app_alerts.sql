-- Migration number: 0211
-- The client's alerts in their app (docs/decisions/0255-client-alerts-and-push.md): one beside each message written to
-- them about their account or their visits, whether or not WhatsApp sends it, and one each time a technician asks them
-- to sign off a fit; and the session that takes the pushes telling the app of them. New tables, and triggers that write
-- only them; the arrival notice reads its insert's returned row, which theirs leave alone, and ships first (ADR 0255).

CREATE TABLE client_app_alerts (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  -- The kind of message it stands beside (src/config/message-kinds.ts), or sign_off_asked.
  kind TEXT NOT NULL,
  -- What it is about, as the message names it: a visit, a payment, a proposed move, a technician's update.
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  -- One alert a message, and one each time a sign-off is asked.
  once_key TEXT NOT NULL,
  written_at TEXT NOT NULL,
  -- When the push went; NULL while it is to go.
  pushed_at TEXT,
  read_at TEXT,
  UNIQUE (person_id, once_key)
);

CREATE INDEX client_app_alerts_inbox ON client_app_alerts (person_id, written_at);
CREATE INDEX client_app_alerts_by_time ON client_app_alerts (written_at);

-- The session that takes the client's pushes, one subscription a session, by the push service's own address. A
-- session signed out, revoked or ended takes no pushes, and loses it (src/domain/clients/app-alerts.ts).
CREATE TABLE client_push_subscriptions (
  session_id TEXT PRIMARY KEY REFERENCES sessions (id),
  endpoint TEXT NOT NULL UNIQUE,
  subscribed_at TEXT NOT NULL
);

-- backfill: none. Each trigger writes one alert for the one row it is fired by.

-- Beside each message to a client, but the site's answers to a number we know, the waitlist's confirmation and the
-- answer to a STOP, which are WhatsApp's alone, and a technician's word or arrival heard too late to tell them. One
-- waiting for what it carries, a try-on's look, is told once it is queued.
CREATE TRIGGER client_app_alerts_beside_messages AFTER INSERT ON outbound_messages
WHEN NEW.state NOT IN ('skipped', 'waiting') AND NEW.kind NOT IN (
  'waitlist_confirmation', 'consultation_exists', 'book_in_app', 'address_on_account', 'address_not_served',
  'messages_stopped'
)
BEGIN
  INSERT OR IGNORE INTO client_app_alerts (id, person_id, kind, subject_kind, subject_id, once_key, written_at)
  VALUES (lower(hex(randomblob(16))), NEW.person_id, NEW.kind, NEW.subject_kind, NEW.subject_id, 'message:' || NEW.id,
          NEW.created_at);
END;

CREATE TRIGGER client_app_alerts_beside_messages_ready AFTER UPDATE OF state ON outbound_messages
WHEN OLD.state = 'waiting' AND NEW.state = 'queued' AND NEW.kind NOT IN (
  'waitlist_confirmation', 'consultation_exists', 'book_in_app', 'address_on_account', 'address_not_served',
  'messages_stopped'
)
BEGIN
  INSERT OR IGNORE INTO client_app_alerts (id, person_id, kind, subject_kind, subject_id, once_key, written_at)
  VALUES (lower(hex(randomblob(16))), NEW.person_id, NEW.kind, NEW.subject_kind, NEW.subject_id, 'message:' || NEW.id,
          NEW.queued_at);
END;

-- A technician asks the client to sign off a fit.
CREATE TRIGGER client_app_alerts_sign_off_asked AFTER INSERT ON fit_sign_offs
WHEN NEW.state = 'asked'
BEGIN
  INSERT OR IGNORE INTO client_app_alerts (id, person_id, kind, subject_kind, subject_id, once_key, written_at)
  SELECT lower(hex(randomblob(16))), a.person_id, 'sign_off_asked', 'appointment', NEW.appointment_id,
         'sign_off_asked:' || NEW.appointment_id || ':' || NEW.asks, NEW.asked_at
    FROM appointments a WHERE a.id = NEW.appointment_id;
END;

-- And again, once what the client flagged is put right.
CREATE TRIGGER client_app_alerts_sign_off_asked_again AFTER UPDATE OF asks ON fit_sign_offs
WHEN NEW.state = 'asked' AND NEW.asks > OLD.asks
BEGIN
  INSERT OR IGNORE INTO client_app_alerts (id, person_id, kind, subject_kind, subject_id, once_key, written_at)
  SELECT lower(hex(randomblob(16))), a.person_id, 'sign_off_asked', 'appointment', NEW.appointment_id,
         'sign_off_asked:' || NEW.appointment_id || ':' || NEW.asks, NEW.asked_at
    FROM appointments a WHERE a.id = NEW.appointment_id;
END;
