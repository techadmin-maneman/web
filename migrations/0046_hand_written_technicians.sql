-- Migration number: 0046
-- The technicians the FSM sync does not own (docs/decisions/0052-technician-sessions.md).
-- scripts/seed-technician-tester.ts and the staging proof (e2e/tech-staging/seed.ts) write a
-- technician straight into staging's database, with no FSM user behind him, so that a person
-- can sign in on a real phone and the proof has someone to walk the app as. Since 25 September
-- 2026 the sync makes inactive every technician FSM's list leaves out (ADR 0065), and FSM
-- lists none of these, so its next read of the list, nightly or on a sign-in with a number
-- the mirror did not know, would switch each of them off, and no code would reach him. A row
-- marked here was written by hand, and the sync leaves it alone (src/domain/fsm-mirror.ts).
--
-- A column is added, and 0 is what every other row already is: a row the sync wrote. The
-- rows the two scripts wrote are marked by the fsm_id prefix each gives its own; both write
-- to staging's database only, so production holds none. Nothing else about any row changes.
-- The code already deployed names its columns and never reads this one.

ALTER TABLE technicians ADD COLUMN hand_written INTEGER NOT NULL DEFAULT 0 CHECK (hand_written IN (0, 1));

UPDATE technicians SET hand_written = 1 WHERE fsm_id LIKE 'tech-tester-%' OR fsm_id LIKE 'tech-proof-%';
