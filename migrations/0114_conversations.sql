-- The Care inbox (docs/decisions/0129-the-care-inbox.md): one thread for each number that writes to our WhatsApp
-- number, and every message in it. Our automatic messages stay in outbound_messages; a thread reads both. Today the
-- bridge files what clients write; the office number on MSG91 will file into the same tables.

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  -- The client whose number it is; null for a number we do not know.
  person_id TEXT REFERENCES people (id),
  -- The number the thread is with, as E.164; after an erasure, a placeholder that is nobody's.
  mobile_e164 TEXT NOT NULL,
  -- open: waiting on us; waiting: on the client; closed: settled, until the client writes again.
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'waiting', 'closed')),
  opened_at TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  -- When the client last wrote, which opens WhatsApp's 24-hour window for a free reply.
  last_inbound_at TEXT,
  closed_at TEXT,
  closed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX conversations_by_number ON conversations (mobile_e164);
CREATE INDEX conversations_by_person ON conversations (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX conversations_by_state ON conversations (state, last_message_at);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations (id),
  -- in: from the client; out: our reply; note: for staff alone, never sent.
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out', 'note')),
  -- "client", a member of staff's e-mail, or "system".
  author TEXT NOT NULL,
  -- Null once the client's record is erased.
  text TEXT,
  -- WhatsApp's ID for it, through the bridge or MSG91: a message filed twice is filed once.
  provider_message_id TEXT,
  sent_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX chat_messages_by_conversation ON chat_messages (conversation_id, sent_at);
CREATE UNIQUE INDEX chat_messages_by_provider_id ON chat_messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
