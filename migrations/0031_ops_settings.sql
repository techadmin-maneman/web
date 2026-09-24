-- Migration number: 0031
-- The business inputs ops set for themselves (docs/decisions/0060-ops-editable-inputs.md).
-- One row per input in src/config/ops-settings.ts's register; a row that is not
-- here means the committed default is in force, so an empty table is a working
-- system and never a zero.
--
-- There is no effective date here on purpose. Everything in this table applies
-- from the moment it is set, and what was true when it mattered is already
-- recorded where it mattered: checkins keeps the radius it measured against,
-- pieces keeps the replacement date it was given, audit_log keeps every change
-- with its before and after. The inputs whose history a document depends on --
-- prices and their GST -- stay in price_book, which is dated. Only a new table,
-- so the code already deployed is unaffected.

CREATE TABLE ops_settings (
  -- One of OPS_SETTINGS' names. Not a CHECK constraint, so adding an input
  -- needs no table rebuild, exactly as audit_log's actions do not.
  name TEXT PRIMARY KEY,
  -- JSON: a number, or an object of numbers keyed by the input's own keys.
  -- The register says which, and the bounds, and refuses anything else before
  -- it reaches here.
  value TEXT NOT NULL CHECK (json_valid(value)),
  -- The Access identity that set it, as every ops action records (ADR 0031).
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL
);
