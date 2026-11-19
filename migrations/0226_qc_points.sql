-- Migration number: 0226
-- The points a hair system is checked against as it arrives become rows ops add, rename, switch off and, while no claim
-- names one, delete (docs/decisions/0283-changed-and-deleted-while-unused.md); a claim keeps the names as they read
-- when it was drafted. A new table and column: the Worker already deployed reads and writes neither.

CREATE TABLE qc_points (
  -- The key a receipt and a claim name the point by: one of the five below, or a new point's UUID.
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  sort INTEGER NOT NULL,
  -- 1 while each hair system that arrives is checked against it; 0 once ops switch it off.
  checked INTEGER NOT NULL DEFAULT 1 CHECK (checked IN (0, 1))
);

CREATE UNIQUE INDEX qc_points_by_name ON qc_points (lower(name));

-- The five points the code held, each checked or not as Settings › Purchasing had it.
INSERT INTO qc_points (id, name, sort, checked)
SELECT
  p.column1,
  p.column2,
  p.column3,
  CASE WHEN json_extract((SELECT value FROM ops_settings WHERE name = 'receipt_checks'), '$.' || p.column1) = 'skipped'
    THEN 0 ELSE 1 END
FROM (
  VALUES ('base_size', 'Base size', 10), ('colour', 'Colour against the ring', 20), ('density', 'Density', 30),
    ('lace_knots', 'Lace and knots', 40), ('label', 'Label', 50)
) p;

-- A JSON array of the points' names as they read when the claim was drafted; null where failed_points is.
ALTER TABLE supplier_claims ADD COLUMN failed_point_names TEXT;

-- backfill: each claim naming points takes their names as they read now, which are the code's own.
UPDATE supplier_claims
SET failed_point_names = (
  SELECT json_group_array(q.name) FROM json_each(supplier_claims.failed_points) j JOIN qc_points q ON q.id = j.value
)
WHERE failed_points IS NOT NULL;
