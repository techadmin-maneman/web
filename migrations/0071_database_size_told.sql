-- Migration number: 0071
-- The last mark of the database's own size ops were told of (src/policy/database-size.ts), beside R2's on the storage
-- meter's row: 0 before the first, then 50, 80 or 95.
--
-- Expand only: the Worker already deployed reads nothing of it.

ALTER TABLE storage_meter ADD COLUMN database_told_percent INTEGER NOT NULL DEFAULT 0;
