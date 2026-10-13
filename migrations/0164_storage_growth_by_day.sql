-- Migration number: 0164
-- Where the storage meter's figure stood as an India day began, so the day's growth can be read and an unusual one
-- told (docs/decisions/0194-the-build-on-workers-paid.md). Nullable columns the Worker already deployed reads none of.

ALTER TABLE storage_meter ADD COLUMN growth_date TEXT;
ALTER TABLE storage_meter ADD COLUMN growth_from_bytes INTEGER;
