-- The words ops change on the site and in the WhatsApp messages to clients (docs/decisions/0126-the-words-page.md):
-- every wording a line has had, by its key in src/config/words.json. The newest is the one in force; a null text puts
-- the line back to its wording in the code. A wording is never rewritten, so going back to one is another row.
CREATE TABLE word_versions (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  text TEXT,
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL
);

CREATE INDEX word_versions_by_key ON word_versions (key, set_at);
