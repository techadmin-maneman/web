-- Migration number: 0042
-- Ops name an area themselves (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).
-- serviceable_pincodes.area starts as the shortest of a pincode's post offices ("Sec91",
-- "RAKNPA"), and a launch message, the waitlist and the dispatch board all read it. Ops now
-- rename it from the console; this says who did, so scripts/import-pincodes.ts, which
-- refreshes the post offices' names, leaves a name ops gave alone. Null while the name is
-- still the post offices'.
--
-- Only a column is added, so the code already deployed is unaffected.

ALTER TABLE serviceable_pincodes ADD COLUMN area_named_by TEXT;
