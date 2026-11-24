-- Migration number: 0238
-- A technician's pay grade by the day it applies from (docs/decisions/0311-dated-technician-grades.md), as visit rates
-- are: a visit is paid on the grade in force on its day, so changing a grade never re-prices a month already worked.
-- technicians.pay_grade_id stays, written as the grade in force today, so the release before this one reads it still.

-- A grade from a day on; grade_id NULL takes the technician's grade away from that day.
CREATE TABLE technician_grades (
  technician_id TEXT NOT NULL REFERENCES technicians (id),
  grade_id TEXT REFERENCES pay_grades (id),
  -- India's date it applies from.
  effective_from TEXT NOT NULL,
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL,
  PRIMARY KEY (technician_id, effective_from)
);

-- A grade's technicians, as Pay grades counts them and a grade's deletion checks.
CREATE INDEX technician_grades_grade ON technician_grades (grade_id);

-- Every technician's grade today, from the earliest day any visit could be priced, so each past statement prices as
-- it did before this migration.
-- backfill: one row a technician with a grade (under 50 anywhere) and its index entries: under 150 writes.
INSERT INTO technician_grades (technician_id, grade_id, effective_from, set_by, set_at)
SELECT id, pay_grade_id, '2000-01-01', 'migration 0238', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM technicians WHERE pay_grade_id IS NOT NULL;
