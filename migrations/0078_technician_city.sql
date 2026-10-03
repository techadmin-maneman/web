-- Migration number: 0078
-- The city a technician works in, which ops set on the Technicians screen. Staff access by place reads it: a grant of
-- a city or its zone reaches the technicians of that city, and a technician with no city is reached only nationally.
-- Only a nullable column is added, so the Worker already deployed is unaffected.

ALTER TABLE technicians ADD COLUMN city TEXT REFERENCES cities (name);
