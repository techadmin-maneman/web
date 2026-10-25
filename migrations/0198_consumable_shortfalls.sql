-- A job that used less than its service expects, or nothing at all on a visit that always uses something, with the
-- technician's reason (docs/decisions/0222-consumables-short-of-expected.md). One row a visit: a corrected step
-- replaces it. Ops are given a task for each until they close it, which settles the row.
CREATE TABLE consumable_shortfalls (
  appointment_id TEXT PRIMARY KEY,
  technician_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('client_supplies', 'ran_out', 'not_needed', 'other')),
  -- Each consumable recorded below what was expected: [{"code", "expected", "used"}]; empty where nothing was used.
  short TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  settled_at TEXT
);

CREATE INDEX consumable_shortfalls_open ON consumable_shortfalls (recorded_at) WHERE settled_at IS NULL;
