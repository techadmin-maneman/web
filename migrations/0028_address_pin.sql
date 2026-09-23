-- Migration number: 0028
-- The parts of an address a technician needs to find the door, and the
-- coordinate the check-in's geofence measures against
-- (docs/decisions/0054-address-capture.md).
--
-- `checkins.address_id` references `addresses (id)`, so that table can never be
-- rebuilt: D1 applies a migration in one transaction, and SQLite counts
-- dropping a parent as a violation that re-creating it does not undo. That is
-- the fault that withdrew migration 0025. Every column here is therefore a
-- nullable ADD COLUMN, and the six free-text fields are untouched: an address
-- saved before this renders exactly as it did.

-- The building or society as the client chose it from the suggestions, kept
-- apart from line1 so the old free-text addresses keep their meaning.
ALTER TABLE addresses ADD COLUMN building TEXT;
-- "Flat 1203", "House 4417": the part no map knows and only the client can give.
ALTER TABLE addresses ADD COLUMN flat TEXT;
ALTER TABLE addresses ADD COLUMN floor TEXT;
ALTER TABLE addresses ADD COLUMN tower TEXT;
-- "Opposite the Sector 65 metro gate": what a technician navigates by when the
-- pin lands in the middle of a large society.
ALTER TABLE addresses ADD COLUMN landmark TEXT;

-- Google's Place ID for the building. Exempt from their caching restriction and
-- storable for good, so it is what we keep rather than their suggestion text;
-- it is also what re-resolves the coordinate if the address is ever rechecked
-- (docs/decisions/0054-address-capture.md, "What may be kept").
ALTER TABLE addresses ADD COLUMN place_id TEXT;

-- Where lat/lng came from, because the licence differs by source and a
-- coordinate we observed is worth more than one a provider computed:
--   google_geocoding  the Geocoding API, resolved from the Place ID above
--   device            the client's own phone, through navigator.geolocation
--   checkin           a technician who has stood at the door
-- The last two are not written yet (ADR 0054 ranks them first and cheapest);
-- they are listed now so adding them needs no second migration.
ALTER TABLE addresses ADD COLUMN geocode_source TEXT CHECK (
  geocode_source IS NULL OR geocode_source IN ('google_geocoding', 'device', 'checkin')
);
