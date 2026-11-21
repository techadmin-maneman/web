-- How far a technician goes from home, in straight-line km (docs/decisions/0289-who-takes-a-visit.md); null takes the
-- ops setting's. It replaces reach_min, minutes of driving, which stays until the release before it has gone. A
-- technician's own reach becomes the km it covered, the drive estimate's defaults run backwards: (minutes less ten to
-- park) at 24 km/h, over a road 40% longer than the straight line, so 45 minutes is 10 km.
ALTER TABLE technicians ADD COLUMN radius_km INTEGER CHECK (radius_km IS NULL OR radius_km BETWEEN 1 AND 60);

UPDATE technicians
SET radius_km = MIN(60, MAX(1, CAST(ROUND((reach_min - 10) * 0.4 * 100 / 140) AS INTEGER)))
WHERE reach_min IS NOT NULL;
