-- The start a move proposal puts the visit at (docs/decisions/0210-booking-by-start-time.md), which the client's
-- acceptance moves it to, in place of the window's earliest start with room. Only a new column; the code deployed
-- neither reads nor writes it.
ALTER TABLE move_proposals ADD COLUMN starts_at TEXT;
