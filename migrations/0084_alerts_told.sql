-- Migration number: 0084
--
-- When an alert was first told, which is when it became a person's to act on:
-- an alert that waits for its `after`-th sighting is kept from its first, and
-- is not yet one. The Tasks board's "Needs a hand" lists the open alerts that
-- have been told. The code already deployed reads none of this.

ALTER TABLE alerts ADD COLUMN told_at TEXT;

-- What is open now was told, as far as anyone can know: most alerts are told at their first sighting.
UPDATE alerts SET told_at = first_seen_at WHERE resolved_at IS NULL;

CREATE INDEX alerts_open_told ON alerts (told_at) WHERE resolved_at IS NULL AND told_at IS NOT NULL;
