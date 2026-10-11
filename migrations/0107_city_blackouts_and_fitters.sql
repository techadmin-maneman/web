-- Migration number: 0107
-- A day closed in one city only, beside visit_blackouts' days closed everywhere; and whether a technician is trained to
-- fit, which a first fit needs (docs/decisions/0119-blackouts-by-city-and-trained-fitters.md).
-- Expand only: a new table and a new column. The Worker already deployed reads neither.

CREATE TABLE city_blackouts (
  date TEXT NOT NULL,
  city TEXT NOT NULL REFERENCES cities (name),
  reason TEXT NOT NULL,
  set_by TEXT,
  set_at TEXT,
  PRIMARY KEY (date, city)
);

ALTER TABLE technicians ADD COLUMN fits_trained INTEGER NOT NULL DEFAULT 0 CHECK (fits_trained IN (0, 1));
