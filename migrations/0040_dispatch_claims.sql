-- Migration number: 0040
-- contract: docs/decisions/0069-dispatch-under-concurrency.md
--
-- A move on the dispatch board claims the time it moves a job to, in the same
-- slot_claims that stop two holds taking one technician's time, before it
-- writes to FSM, and lets the claims go once FSM has answered. A claim now
-- belongs to a hold or to a move, so hold_id becomes optional and move_id is
-- added, with exactly one of the two set.
--
-- slot_claims is rebuilt rather than swapped in place (docs/migrations.md):
-- nothing points at it, so dropping it disturbs no reference, and a NOT NULL
-- cannot be taken off a column any other way. The rebuild is one transaction,
-- keeps every claim, and keeps the four columns the running Worker reads and
-- writes, so the code already deployed inserts and reads as it did; it never
-- sees a move's claim, which only lasts while a move is being written.

CREATE TABLE slot_claims_next (
  technician_id TEXT NOT NULL REFERENCES technicians (id),
  date TEXT NOT NULL,
  claim TEXT NOT NULL,
  hold_id TEXT REFERENCES slot_holds (id),
  move_id TEXT REFERENCES dispatch_moves (id),
  CHECK ((hold_id IS NULL) <> (move_id IS NULL)),
  PRIMARY KEY (technician_id, date, claim)
);

INSERT INTO slot_claims_next (technician_id, date, claim, hold_id)
SELECT technician_id, date, claim, hold_id FROM slot_claims;

DROP TABLE slot_claims;

ALTER TABLE slot_claims_next RENAME TO slot_claims;

CREATE INDEX slot_claims_by_hold ON slot_claims (hold_id);
CREATE INDEX slot_claims_by_move ON slot_claims (move_id) WHERE move_id IS NOT NULL;

-- One move of a job at a time: a second, sent while the first is still with
-- FSM, fails on this index and is answered as superseded. A move still pending
-- as this runs either never finished or has seconds left; it is closed either
-- way, and one that does finish marks itself written.
UPDATE dispatch_moves
SET fsm_write_state = 'rejected',
  fsm_error = 'never finished: FSM may hold it, and its own record says',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE fsm_write_state = 'pending';

CREATE UNIQUE INDEX dispatch_moves_one_at_a_time ON dispatch_moves (appointment_id)
WHERE fsm_write_state = 'pending';

-- A client who has not agreed to WhatsApp is told of a move by phone. Ops
-- record that they called, which closes the task (src/policy/tasks.ts).
ALTER TABLE dispatch_moves ADD COLUMN told_at TEXT;
ALTER TABLE dispatch_moves ADD COLUMN told_by TEXT;
