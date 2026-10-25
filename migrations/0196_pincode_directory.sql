-- Migration number: 0196
-- Every pincode India Post lists, read-only, from which ops choose the ones we serve (src/domain/clients/pincode-
-- directory.ts): its district and state, its post offices, and the delivering office's point. Loaded and refreshed by
-- scripts/ops/load-pincode-directory.ts from data/pincodes/india-pincodes.csv. Only a new table: the Worker already
-- deployed reads nothing of it.

CREATE TABLE pincode_directory (
  pincode TEXT PRIMARY KEY CHECK (pincode GLOB '[1-9][0-9][0-9][0-9][0-9][0-9]'),
  district TEXT NOT NULL CHECK (length(district) BETWEEN 1 AND 80),
  state TEXT NOT NULL CHECK (length(state) BETWEEN 1 AND 80),
  -- The post offices in the pincode, separated by semicolons, as the directory names them ("Saket SO;Pushp Vihar SO").
  office_names TEXT NOT NULL,
  -- The delivering office's point: rough, for a map and for opening a city, never for a drive.
  latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN 6 AND 38),
  longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN 68 AND 98),
  -- The directory's own date, from the file it was loaded from.
  refreshed_on TEXT NOT NULL
);

CREATE INDEX pincode_directory_by_district ON pincode_directory (state, district);
