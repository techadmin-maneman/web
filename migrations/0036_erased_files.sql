-- Migration number: 0036
-- An erasure deletes a person's files after its D1 batch, not before it
-- (docs/decisions/0066-erasure-all-or-nothing.md). `files_erased_at` is set once
-- their try-on photographs and results, visit photographs and referral card are
-- gone from R2; while it is NULL on an erased person, the cron's erased_files
-- job deletes what is left. Only a new column and an index, so the code already
-- deployed is unaffected.

ALTER TABLE people ADD COLUMN files_erased_at TEXT;

-- Everyone erased so far had their files deleted before the rest, as erasure then did.
UPDATE people SET files_erased_at = erased_at WHERE erased_at IS NOT NULL;

CREATE INDEX people_files_to_erase ON people (erased_at) WHERE erased_at IS NOT NULL AND files_erased_at IS NULL;
