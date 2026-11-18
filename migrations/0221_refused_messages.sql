-- Migration number: 0221
-- A WhatsApp message WhatsApp refused after taking it (docs/decisions/0276-a-message-whatsapp-refuses.md): the
-- provider's report marks it failed, with WhatsApp's code, and Care's Tasks queue of messages not delivered reads
-- them (src/domain/ops/task-queues.ts). A new index: the Worker already deployed reads and writes nothing new.
CREATE INDEX outbound_messages_refused ON outbound_messages (created_at)
  WHERE state = 'failed' AND provider_message_id IS NOT NULL;

-- backfill: none. A message refused before this migration was never reported as refused, so none reads as one.
