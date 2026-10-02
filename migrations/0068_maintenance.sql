-- Migration number: 0068
-- A switch that stops the cron and the queue consumers while D1 is restored (docs/runbook.md, "Restoring D1";
-- src/domain/maintenance.ts). A new table, empty: the Worker already deployed reads nothing of it.

-- While its one row is here, the cron and every queue consumer stop before they read or write anything else.
CREATE TABLE maintenance (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  reason TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
