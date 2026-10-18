-- Migration number: 0190
-- Packages (docs/decisions/0211-packages.md): each first fit's product becomes a package with a service visit and a
-- replacement of its own, each hair system a selling price, and each client the package they are on. A first fit's
-- and a replacement's price are now made of parts, split here so every total stays as it was. Only new rows, a new
-- table and a new column: the Worker already deployed reads none of them.

CREATE TABLE packages (
  -- The code its three services share as their tier, and its hair systems name as their product. Its name,
  -- description, order and retirement are its first-fit service's.
  code TEXT PRIMARY KEY CHECK (
    length(code) BETWEEN 1 AND 32 AND code GLOB '[a-z]*' AND code NOT GLOB '*[^a-z0-9_]*'
  ),
  -- Days from a visit to the service visit after it.
  service_every_days INTEGER NOT NULL CHECK (service_every_days BETWEEN 7 AND 180),
  -- Months from a fit to the replacement of the hair system fitted.
  replace_after_months INTEGER NOT NULL CHECK (replace_after_months BETWEEN 1 AND 36),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- backfill: one row a first-fit service, a handful. Each starts with the cadence and the default cycle ops set.
INSERT INTO packages (code, service_every_days, replace_after_months, updated_by, updated_at)
SELECT tier,
  COALESCE((SELECT CAST(json_extract(value, '$.service_cadence') AS INTEGER) FROM ops_settings WHERE name = 'booking_days'), 30),
  COALESCE((SELECT max(1, CAST(round(json_extract(value, '$.default') / 30.0) AS INTEGER)) FROM ops_settings WHERE name = 'piece_cycle_days'), 6),
  'migrations/0190_packages.sql', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM services WHERE kind = 'first_fit';

-- backfill: two services a package, a handful. The standard package already has both.
INSERT OR IGNORE INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
SELECT k.kind, f.tier, f.name || k.suffix,
  COALESCE((SELECT minutes FROM services WHERE kind = k.kind AND tier = 'standard'), k.minutes),
  f.sort, 'migrations/0190_packages.sql', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM services f,
  (SELECT 'service' AS kind, ' service visit' AS suffix, 90 AS minutes
   UNION ALL SELECT 'replacement', ' replacement', 135) k
WHERE f.kind = 'first_fit';

-- backfill: the prices below are a few dozen rows, from India's today. A package's service visit costs what the
-- standard one does; its replacement, and each hair system, what the visit cost less that service visit.
INSERT OR IGNORE INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from)
SELECT 'service', p.code, s.amount_ex_gst, s.gst_percent, date('now', '+330 minutes')
FROM packages p,
  (SELECT amount_ex_gst, gst_percent FROM price_book WHERE item = 'service' AND tier = 'standard'
     AND valid_from <= date('now', '+330 minutes') ORDER BY valid_from DESC LIMIT 1) s
WHERE p.code != 'standard' AND NOT EXISTS (SELECT 1 FROM price_book b WHERE b.item = 'service' AND b.tier = p.code);

INSERT OR IGNORE INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from)
SELECT 'replacement', code, max(0, whole - service), gst, date('now', '+330 minutes') FROM (
  SELECT p.code,
    (SELECT b.amount_ex_gst FROM price_book b WHERE b.item = 'replacement' AND b.tier IN (p.code, 'standard')
       AND b.valid_from <= date('now', '+330 minutes') ORDER BY b.tier = p.code DESC, b.valid_from DESC LIMIT 1) AS whole,
    (SELECT b.gst_percent FROM price_book b WHERE b.item = 'replacement' AND b.tier IN (p.code, 'standard')
       AND b.valid_from <= date('now', '+330 minutes') ORDER BY b.tier = p.code DESC, b.valid_from DESC LIMIT 1) AS gst,
    COALESCE((SELECT b.amount_ex_gst FROM price_book b WHERE b.item = 'service' AND b.tier = 'standard'
       AND b.valid_from <= date('now', '+330 minutes') ORDER BY b.valid_from DESC LIMIT 1), 0) AS service
  FROM packages p WHERE p.code != 'standard'
) WHERE whole IS NOT NULL;

INSERT OR IGNORE INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from)
SELECT 'hair_system', code, max(0, whole - service), gst, date('now', '+330 minutes') FROM (
  SELECT h.code,
    (SELECT b.amount_ex_gst FROM price_book b WHERE b.item = 'first_fit' AND b.tier = h.product
       AND b.valid_from <= date('now', '+330 minutes') ORDER BY b.valid_from DESC LIMIT 1) AS whole,
    (SELECT b.gst_percent FROM price_book b WHERE b.item = 'first_fit' AND b.tier = h.product
       AND b.valid_from <= date('now', '+330 minutes') ORDER BY b.valid_from DESC LIMIT 1) AS gst,
    COALESCE((SELECT b.amount_ex_gst FROM price_book b WHERE b.item = 'service' AND b.tier = 'standard'
       AND b.valid_from <= date('now', '+330 minutes') ORDER BY b.valid_from DESC LIMIT 1), 0) AS service
  FROM hair_systems h
) WHERE whole IS NOT NULL;

-- backfill: what a package's service visit and replacement use, and what its replacement costs us, start as the
-- standard ones': a few dozen rows.
INSERT OR IGNORE INTO consumable_usage (visit_type, tier, consumable_code, quantity, set_by, set_at)
SELECT u.visit_type, p.code, u.consumable_code, u.quantity, 'migrations/0190_packages.sql', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM packages p JOIN consumable_usage u ON u.visit_type IN ('service', 'replacement') AND u.tier = 'standard'
WHERE p.code != 'standard';

INSERT OR IGNORE INTO standard_costs (item, tier, cost, valid_from, set_by, set_at)
SELECT c.item, p.code, c.cost, c.valid_from, 'migrations/0190_packages.sql', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM packages p JOIN standard_costs c ON c.item = 'replacement' AND c.tier = 'standard'
WHERE p.code != 'standard';

-- A city's own service visit price is each package's there too.
INSERT OR IGNORE INTO city_prices (item, tier, city, amount_ex_gst, gst_percent, valid_from)
SELECT 'service', p.code, c.city, c.amount_ex_gst, c.gst_percent, c.valid_from
FROM packages p JOIN city_prices c ON c.item = 'service' AND c.tier = 'standard'
WHERE p.code != 'standard';

-- The package a client is on: the one they last booked a first fit or a replacement of, or ops chose. Null for one
-- who has booked neither, whose consultation's recommendation, in their hair profile, stands in.
ALTER TABLE people ADD COLUMN package TEXT;

-- backfill: one write a client fitted, a few dozen: their last first fit's product.
UPDATE people SET package = (
  SELECT COALESCE(a.tier, 'standard') FROM appointments a
  WHERE a.person_id = people.id AND a.type = 'first_fit' AND a.status != 'cancelled' AND a.deleted_at IS NULL
  ORDER BY a.window_start DESC LIMIT 1)
WHERE id IN (
  SELECT person_id FROM appointments
  WHERE type = 'first_fit' AND status != 'cancelled' AND deleted_at IS NULL AND person_id IS NOT NULL);
