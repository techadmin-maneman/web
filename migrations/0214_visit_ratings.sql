-- Migration number: 0214
-- Ratings (docs/decisions/0260-ratings.md): the client's stars for a visit done, one each, kept with the technician who
-- did it, so their quality on Me can count them; and whether the stars were under the setting in force when given,
-- which opens a Care task until Care have called. A new table: the Worker already deployed reads and writes none of it.

CREATE TABLE visit_ratings (
  appointment_id TEXT PRIMARY KEY REFERENCES appointments (id),
  person_id TEXT NOT NULL REFERENCES people (id),
  -- Whoever did the visit, as it was closed; NULL for one no technician held.
  technician_id TEXT REFERENCES technicians (id),
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  -- Under ops' setting `ratings.low_below` when given: a later change of the setting moves no rating.
  low INTEGER NOT NULL CHECK (low IN (0, 1)),
  created_at TEXT NOT NULL
);

-- A technician's ratings over the last days, for their quality on Me (src/domain/field/quality.ts).
CREATE INDEX visit_ratings_by_technician ON visit_ratings (technician_id, created_at);
-- The Tasks queue of low ratings reads only these (src/domain/ops/task-queues.ts).
CREATE INDEX visit_ratings_low ON visit_ratings (created_at) WHERE low = 1;
-- A client's own ratings, for their data's copy; erasure keeps the stars, which hold no words.
CREATE INDEX visit_ratings_by_person ON visit_ratings (person_id);

-- backfill: none. No visit was rated before this migration.
