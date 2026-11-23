-- Migration number: 0236
-- A technician's start date (docs/decisions/0305-a-technicians-start-date.md), given on Add and Edit and shown as
-- "Started ..." in their head. A new column: the Worker already deployed reads and writes none of it.

-- The day they started with us; null where it was never given.
ALTER TABLE technicians ADD COLUMN start_date TEXT;

-- backfill: none. No technician's start was recorded before this migration, so each stays null until ops give it.
