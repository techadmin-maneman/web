-- How far a technician goes from home, in minutes of driving by the estimate booking plans with
-- (docs/decisions/0223-reach-from-home.md). Null takes the ops setting's.
ALTER TABLE technicians ADD COLUMN reach_min INTEGER CHECK (reach_min IS NULL OR reach_min BETWEEN 10 AND 180);
