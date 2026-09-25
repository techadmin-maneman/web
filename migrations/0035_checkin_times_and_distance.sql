-- Migration number: 0035
-- contract: docs/decisions/0065-a-technicians-writes-reach-fsm.md
--
-- A check-in's times, and a distance that can say "not measured"
-- (docs/decisions/0065-a-technicians-writes-reach-fsm.md).
--
-- `at` is the phone's time for the arrival, held within the bounds of
-- src/policy/phone-clock.ts, and `created_at` is when the server received it.
-- `claimed_at` keeps what the phone itself said, so ops can see a clock that
-- was set back; it is null where the phone gave no time.
--
-- `distance_m` was NOT NULL, so a check-in at an address with no coordinate
-- stored a filler 0 that every reader had to know to ignore. It becomes
-- nullable, and the old fillers become null: a check-in that named no address
-- measured nothing (src/domain/check-ins.ts has always left address_id null
-- exactly then).
--
-- no_show_cases points at checkins, and D1 runs a migration in one transaction,
-- where dropping a referenced table is a violation re-creating it does not undo
-- (migration 0025, withdrawn). So nothing is rebuilt: the column is swapped in
-- place, as migration 0031 did. The code already deployed names its columns
-- and still writes a 0, which the new column takes.

ALTER TABLE checkins ADD COLUMN claimed_at TEXT;

ALTER TABLE checkins ADD COLUMN distance_m_next INTEGER CHECK (distance_m_next >= 0);

UPDATE checkins SET distance_m_next = CASE WHEN address_id IS NULL THEN NULL ELSE distance_m END;

ALTER TABLE checkins DROP COLUMN distance_m;

ALTER TABLE checkins RENAME COLUMN distance_m_next TO distance_m;
