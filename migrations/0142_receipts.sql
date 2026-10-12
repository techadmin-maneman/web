-- Receipts against purchase orders (docs/decisions/0167-receipts-and-landed-cost.md): what arrived of each line, what
-- was damaged or failed its check, its lot, and what one cost landed: the supplier's price in rupees and its share of the
-- freight, duty and clearing. A lot keeps the landed cost of its latest receipt.
CREATE TABLE receipts (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders (id),
  received_by TEXT NOT NULL,
  received_at TEXT NOT NULL,
  -- The supplier's own invoice number, as printed.
  supplier_invoice TEXT,
  -- Paise per one unit of the order's currency: 100 for rupees, 8325 for a dollar at Rs. 83.25.
  rupee_rate INTEGER NOT NULL CHECK (rupee_rate > 0),
  freight_paise INTEGER NOT NULL CHECK (freight_paise >= 0),
  duty_paise INTEGER NOT NULL CHECK (duty_paise >= 0),
  clearing_paise INTEGER NOT NULL CHECK (clearing_paise >= 0),
  -- Ops' own words. Never a client's name.
  note TEXT
);

CREATE INDEX receipts_by_order ON receipts (po_id);

CREATE TABLE receipt_lines (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES receipts (id),
  po_line_id TEXT NOT NULL REFERENCES po_lines (id),
  -- Accepted into stock; the damaged and those that failed their check never enter it.
  received INTEGER NOT NULL CHECK (received >= 0),
  damaged INTEGER NOT NULL CHECK (damaged >= 0),
  qc_failed INTEGER NOT NULL CHECK (qc_failed >= 0),
  lot_code TEXT,
  expires_on TEXT,
  landed_unit_paise INTEGER NOT NULL CHECK (landed_unit_paise >= 0),
  -- The delivery into the warehouse; null where nothing of the line was accepted.
  movement_id TEXT REFERENCES stock_movements (id)
);

CREATE INDEX receipt_lines_by_receipt ON receipt_lines (receipt_id);

ALTER TABLE stock_lots ADD COLUMN landed_cost_paise INTEGER;
