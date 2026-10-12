-- Custom orders (docs/decisions/0174-custom-orders.md): a hair system made for one client to their exact spec, where no
-- stock code is. Raised by ops, paid in full by a payment link before anything is ordered, then drafted as a purchase
-- order of its own, whose line names it.
CREATE TABLE custom_orders (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  person_id TEXT NOT NULL REFERENCES people (id),
  -- The spec, from the client's hair profile when raised.
  product TEXT NOT NULL,
  base_width_in REAL NOT NULL,
  base_length_in REAL NOT NULL,
  colour TEXT NOT NULL,
  grey_percent INTEGER NOT NULL,
  density_percent INTEGER NOT NULL,
  wave TEXT,
  note TEXT,
  supplier_id TEXT NOT NULL REFERENCES suppliers (id),
  -- One piece's price from the supplier, in its currency's smallest unit; and what the client pays, in paise.
  supplier_price INTEGER NOT NULL CHECK (supplier_price >= 0),
  amount INTEGER NOT NULL CHECK (amount > 0),
  promised_on TEXT,
  state TEXT NOT NULL CHECK (state IN ('awaiting_payment', 'paid', 'cancelled')),
  razorpay_link_id TEXT UNIQUE,
  short_url TEXT,
  link_sent_at TEXT,
  razorpay_payment_id TEXT,
  paid_at TEXT,
  -- The stock code made to its spec, and the purchase order drafted for it, once paid.
  consumable_code TEXT REFERENCES consumables (code),
  po_id TEXT REFERENCES purchase_orders (id),
  raised_by TEXT NOT NULL,
  raised_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX custom_orders_by_person ON custom_orders (person_id);
CREATE INDEX custom_orders_open ON custom_orders (number) WHERE state <> 'cancelled';

ALTER TABLE po_lines ADD COLUMN custom_order_id TEXT REFERENCES custom_orders (id);
