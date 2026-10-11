-- Replies, notes and closing in the Care inbox (docs/decisions/0130-replies-from-the-care-inbox.md): whether a reply
-- reached WhatsApp, and why a thread was closed.

-- For a reply: sent, or failed with why; null for the client's messages and staff's notes.
ALTER TABLE chat_messages ADD COLUMN delivery TEXT CHECK (delivery IN ('sent', 'failed'));
ALTER TABLE chat_messages ADD COLUMN failure TEXT;

-- What the chat was about, as Care closed it.
ALTER TABLE conversations ADD COLUMN close_reason TEXT;
