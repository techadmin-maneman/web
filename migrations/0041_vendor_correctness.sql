-- Migration number: 0041
-- Vendor correctness (docs/decisions/0069-vendor-correctness.md). Only new
-- columns and a new table, so the code already deployed is unaffected.

-- When FSM last failed to say what a visit's client asked for. The pass asks
-- about it again an hour later, rather than first on every run
-- (src/domain/asked-windows.ts).
ALTER TABLE appointments ADD COLUMN asked_failed_at TEXT;
