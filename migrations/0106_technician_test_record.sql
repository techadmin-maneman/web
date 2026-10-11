-- Migration number: 0106
-- A technician our own scripts made for staging, marked when they are added rather than read from their name at every
-- sign-in, as a person is (src/policy/staging-test-records.ts). Expand only: the Worker already deployed reads none of it.

ALTER TABLE technicians ADD COLUMN test_record INTEGER NOT NULL DEFAULT 0 CHECK (test_record IN (0, 1));
