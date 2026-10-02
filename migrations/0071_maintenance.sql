-- Migration number: 0071
-- The switch that stands the cron and the queue consumers still while D1 is restored (src/domain/maintenance.ts).
-- A new table, empty: the Worker already deployed reads nothing of it.

-- One row while it is on; none while it is off.
CREATE TABLE maintenance (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  reason TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
