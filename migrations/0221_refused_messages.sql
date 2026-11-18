-- Migration number: 0221
-- A WhatsApp message WhatsApp refused after taking it (docs/decisions/0276-a-message-whatsapp-refuses.md): Care's
-- queue of messages not delivered reads them (src/domain/care/undelivered-messages.ts), and a refused look shown once
-- in the client app is kept as shown on its try-on (src/domain/try-on/refused-looks.ts). A new index and a new column:
-- the Worker already deployed reads and writes neither.
CREATE INDEX outbound_messages_refused ON outbound_messages (created_at)
  WHERE state = 'failed' AND provider_message_id IS NOT NULL;

-- When the client app showed a look WhatsApp refused, once, after sign-in; null until then, or for a look delivered.
ALTER TABLE tryon_jobs ADD COLUMN look_shown_at TEXT;

-- backfill: none. A message refused before this migration was never reported as refused, so none reads as one.
