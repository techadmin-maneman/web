-- Each time the site's words were published from the Words page (docs/decisions/0127-publishing-the-words.md): every
-- line of the site changed there, as it stood, which each build of this environment's site lays over its copy until
-- the next publish.
CREATE TABLE site_word_publishes (
  id TEXT PRIMARY KEY,
  -- JSON: each changed line's key, as src/config/words.json names it, and its words.
  words TEXT NOT NULL,
  lines INTEGER NOT NULL,
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL
);

CREATE INDEX site_word_publishes_by_time ON site_word_publishes (published_at);
