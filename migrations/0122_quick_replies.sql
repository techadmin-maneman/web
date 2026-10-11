-- Saved answers Customer Care pick in a chat (docs/decisions/0141-quick-replies.md), kept by a Customer Care manager;
-- {name} and {next_visit} in the text are filled in with the client's first name and next visit.
CREATE TABLE quick_replies (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- Taken off the list; kept, as the record of what was offered.
  retired_at TEXT
);
