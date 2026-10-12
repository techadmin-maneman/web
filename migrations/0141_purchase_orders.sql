-- Purchase orders (docs/decisions/0166-purchase-orders.md): what we order from a supplier, drafted, approved once, or
-- twice above the amount ops set, sent, received and closed, or cancelled. Each line keeps the price it was ordered at.
CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  -- Shown as PO-0001, one after another.
  number INTEGER NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers (id),
  -- The supplier's currency when it was drafted, which its lines' prices are in.
  currency TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('drafted', 'approved', 'sent', 'part_received', 'received', 'closed', 'cancelled')),
  -- India's date the supplier promised it for.
  expected_on TEXT,
  -- Ops' own words. Never a client's name.
  note TEXT,
  drafted_by TEXT NOT NULL,
  drafted_at TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  second_approved_by TEXT,
  second_approved_at TEXT,
  sent_by TEXT,
  sent_at TEXT,
  cancelled_by TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT,
  updated_at TEXT NOT NULL,
  CHECK (second_approved_by IS NULL OR second_approved_by <> approved_by)
);

CREATE INDEX purchase_orders_open ON purchase_orders (expected_on) WHERE state IN ('approved', 'sent', 'part_received');

CREATE TABLE po_lines (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders (id),
  consumable_code TEXT NOT NULL REFERENCES consumables (code),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  -- One unit's price in the order's currency, in its smallest unit, as the supplier listed it when drafted.
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  received_quantity INTEGER NOT NULL DEFAULT 0 CHECK (received_quantity >= 0)
);

CREATE INDEX po_lines_by_order ON po_lines (po_id);
