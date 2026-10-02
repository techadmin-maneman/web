-- Migration number: 0066
-- A client's note on their visit is written to the visit's appointment in FSM
-- (docs/decisions/0099-the-clients-note-in-fsm.md). One column is added, empty on every visit there is. The Worker
-- already deployed reads and writes nothing of it, and writes no note to FSM.

-- When the visit's note last reached FSM, so an erasure knows which appointments' notes to blank there, and blanks
-- them once. Emptied again when the erasure has blanked it.
ALTER TABLE appointments ADD COLUMN fsm_note_written_at TEXT;
