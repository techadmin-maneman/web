-- Suppliers (docs/decisions/0165-suppliers.md): who we buy stock from and on what terms, and for each stock code they
-- supply their own code, price, pack, minimum order and the lead time they promise. A supplier is retired, never deleted.
CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- India's GST number; null for a supplier abroad, or one not registered.
  gstin TEXT,
  -- ISO 3166 alpha-2, and the ISO 4217 currency its invoices are in, which its prices are kept in.
  country TEXT NOT NULL,
  currency TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  payment_terms_days INTEGER NOT NULL CHECK (payment_terms_days >= 0),
  -- How long after a piece is fitted the supplier takes it back if it fails; nought for none.
  warranty_days INTEGER NOT NULL CHECK (warranty_days >= 0),
  retired_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX suppliers_by_name ON suppliers (name COLLATE NOCASE);

CREATE TABLE supplier_items (
  supplier_id TEXT NOT NULL REFERENCES suppliers (id),
  consumable_code TEXT NOT NULL REFERENCES consumables (code),
  their_code TEXT,
  -- One unit's price in the supplier's currency, in its smallest unit: paise for rupees, cents for dollars.
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  pack_size INTEGER NOT NULL CHECK (pack_size > 0),
  minimum_order INTEGER NOT NULL CHECK (minimum_order > 0),
  lead_time_days INTEGER NOT NULL CHECK (lead_time_days >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (supplier_id, consumable_code)
);

CREATE INDEX supplier_items_by_code ON supplier_items (consumable_code);
