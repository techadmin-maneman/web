-- Migration number: 0100
-- A record our own scripts or a staging test made, kept on the person rather than read from a name anyone can type
-- (src/policy/staging-test-records.ts). Set when the record is made, on staging alone; never changed by a rename.
-- Every record today's rule would call a test record is marked, and only those (GLOB matches case as the rule did),
-- so nothing that holds now changes.
--
-- Expand only: a new column. The Worker already deployed reads none of it.

ALTER TABLE people ADD COLUMN test_record INTEGER NOT NULL DEFAULT 0 CHECK (test_record IN (0, 1));

UPDATE people SET test_record = 1
WHERE name IN ('Staging test', 'Load test') OR name GLOB 'Staging test *' OR name GLOB 'Load test *';
