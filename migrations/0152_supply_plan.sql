-- The supply plan (docs/decisions/0180-supply-plan.md): drafted from each forecast run, a line for each move a city is
-- short of, lent from another city's stockroom, sent from the warehouse, or ordered from a supplier, with the figures
-- behind it. Each is approved, with its quantity as ops leave it, or rejected with why; one approved makes its transfer
-- or draft order. A new draft replaces the proposals of the last.
CREATE TABLE plan_lines (
  id TEXT PRIMARY KEY,
  -- The forecast run it was drafted from (forecast_runs), let go with it.
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('transfer', 'order')),
  consumable_code TEXT NOT NULL REFERENCES consumables (code),
  -- The city it is for; NULL for an order, which the warehouse receives for every city.
  city TEXT,
  from_place TEXT REFERENCES stock_places (id),
  to_place TEXT REFERENCES stock_places (id),
  supplier_id TEXT REFERENCES suppliers (id),
  proposed INTEGER NOT NULL CHECK (proposed > 0),
  -- As approved, where ops changed it.
  quantity INTEGER CHECK (quantity > 0),
  -- Why: what the city could use, and what it needs over the lead time and a period, and its safety stock.
  usable INTEGER NOT NULL,
  need REAL NOT NULL,
  safety REAL NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('proposed', 'approved', 'rejected')),
  reject_reason TEXT,
  decided_by TEXT,
  decided_at TEXT,
  -- The purchase order an approved order drafted.
  po_id TEXT REFERENCES purchase_orders (id),
  drafted_at TEXT NOT NULL,
  CHECK ((kind = 'transfer') = (from_place IS NOT NULL AND to_place IS NOT NULL)),
  CHECK ((kind = 'order') = (supplier_id IS NOT NULL))
);

CREATE INDEX plan_lines_open ON plan_lines (drafted_at) WHERE state = 'proposed';
CREATE INDEX plan_lines_by_run ON plan_lines (run_id);
