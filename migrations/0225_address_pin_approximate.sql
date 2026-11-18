-- Migration number: 0225
-- A typed address Google places only roughly keeps that pin, marked approximate, and a check-in there is measured
-- against a wider radius (src/policy/check-in.ts). A new column: the Worker already deployed reads and writes none of it.

-- 1 for a pin Google placed no closer than the street or the area; 0 for one to the building, or none.
ALTER TABLE addresses ADD COLUMN pin_approximate INTEGER NOT NULL DEFAULT 0;

-- backfill: none. A typed address saved before this kept no rough pin, and stays without one.
