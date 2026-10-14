-- Migration number: 0167
-- Cities become rows ops edit, each with its state for GST; GST registrations by state; the prices and rules a city
-- sets apart from the national ones; and a served pincode only in one of our cities (ADR 0198).
--
-- New columns, tables and guards only: the Worker already deployed reads none of them, and writes no pincode elsewhere.

ALTER TABLE cities ADD COLUMN state_code TEXT CHECK (state_code GLOB '[A-Z][A-Z]');
ALTER TABLE cities ADD COLUMN state TEXT;

UPDATE cities SET state_code = 'HR', state = 'Haryana' WHERE name IN ('Gurgaon', 'Faridabad');
UPDATE cities SET state_code = 'DL', state = 'Delhi' WHERE name = 'Delhi';
UPDATE cities SET state_code = 'UP', state = 'Uttar Pradesh' WHERE name IN ('Noida', 'Ghaziabad');
UPDATE cities SET state_code = 'MH', state = 'Maharashtra' WHERE name = 'Mumbai';
UPDATE cities SET state_code = 'KA', state = 'Karnataka' WHERE name = 'Bengaluru';

CREATE TABLE gst_registrations (
  state_code TEXT PRIMARY KEY CHECK (state_code GLOB '[A-Z][A-Z]'),
  gstin TEXT NOT NULL UNIQUE,
  -- The Books branch its invoices are raised under; null for an organisation with no branches.
  books_branch_id TEXT,
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL
);

CREATE TABLE city_prices (
  item TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'standard',
  city TEXT NOT NULL REFERENCES cities (name),
  amount_ex_gst INTEGER NOT NULL CHECK (amount_ex_gst >= 0),
  gst_percent INTEGER NOT NULL CHECK (gst_percent >= 0),
  valid_from TEXT NOT NULL,
  PRIMARY KEY (item, tier, city, valid_from)
);

CREATE TABLE city_settings (
  city TEXT NOT NULL REFERENCES cities (name),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (city, key)
);

CREATE TRIGGER serviceable_pincodes_in_a_city BEFORE INSERT ON serviceable_pincodes
WHEN NOT EXISTS (SELECT 1 FROM cities WHERE name = NEW.city)
BEGIN
  SELECT RAISE(ABORT, 'serviceable_pincodes.city is not one of our cities');
END;

CREATE TRIGGER serviceable_pincodes_moved_to_a_city BEFORE UPDATE OF city ON serviceable_pincodes
WHEN NOT EXISTS (SELECT 1 FROM cities WHERE name = NEW.city)
BEGIN
  SELECT RAISE(ABORT, 'serviceable_pincodes.city is not one of our cities');
END;
