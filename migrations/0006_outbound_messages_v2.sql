-- Migration number: 0006
-- contract: docs/decisions/0041-outbound-messages-for-phase-2.md
--
-- outbound_messages, rebuilt for Phase 2. SQLite cannot change a CHECK
-- constraint in place, and Phase 1's allowed one kind of message only. The
-- rebuild:
--   - drops the CHECK on kind: the kinds are listed in src/domain/messages.ts,
--     so a new kind needs no rebuild;
--   - adds subject_kind, since Phase 2 messages are about appointments,
--     referrals, waitlist entries, payments and pincodes, not only try-ons;
--   - adds delivered_at and read_at, from Evolution's delivery receipts.
--
-- The code already deployed keeps working: it names none of the new columns,
-- and subject_kind defaults to its one subject, the try-on job. Every row is
-- copied across unchanged.

PRAGMA defer_foreign_keys = true;

CREATE TABLE outbound_messages_v2 (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people (id),
  kind TEXT NOT NULL,
  -- What the message is about, and its ID in that table.
  subject_kind TEXT NOT NULL DEFAULT 'tryon_job',
  subject_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('waiting', 'queued', 'sent', 'failed', 'skipped')),
  queued_at TEXT,
  -- Claimed before each send, so two overlapping consumer runs cannot both send it.
  sending_at TEXT,
  provider_message_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  -- No personal data: a provider status and code only.
  last_error TEXT,
  sent_at TEXT,
  -- When WhatsApp reported the message delivered to the phone, and read. The first report wins.
  delivered_at TEXT,
  read_at TEXT
);

INSERT INTO outbound_messages_v2
  (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at, sending_at, provider_message_id,
   attempts, last_error, sent_at)
SELECT id, created_at, person_id, kind, 'tryon_job', subject_id, state, queued_at, sending_at, provider_message_id,
  attempts, last_error, sent_at
FROM outbound_messages;

DROP TABLE outbound_messages;
ALTER TABLE outbound_messages_v2 RENAME TO outbound_messages;

CREATE INDEX outbound_messages_by_state ON outbound_messages (state, queued_at);
CREATE INDEX outbound_messages_by_subject ON outbound_messages (subject_id);
-- A delivery receipt names the message by the provider's ID.
CREATE INDEX outbound_messages_by_provider_id ON outbound_messages (provider_message_id);
