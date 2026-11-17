-- Migration number: 0217
-- Where a hold was made: the client's app, the site, or ops in the console. The technician's card names it as the
-- consultation's "Booked via" (docs/decisions/0269-the-design-checks-api-side.md). A hold made before it has none. Only
-- a new column, which the Worker already deployed leaves empty.
ALTER TABLE slot_holds ADD COLUMN booked_from TEXT CHECK (booked_from IN ('app', 'site', 'ops'));
