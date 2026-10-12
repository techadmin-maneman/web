-- Claims on suppliers (docs/decisions/0169-supplier-claims.md): what arrived damaged or failed its check, drafted with
-- its receipt, and a returned piece still inside its supplier's warranty. Each is sent, then accepted as a credit or a
-- replacement, or rejected; or withdrawn before it is sent.
CREATE TABLE supplier_claims (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers (id),
  consumable_code TEXT NOT NULL REFERENCES consumables (code),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  reason TEXT NOT NULL CHECK (reason IN ('damaged', 'qc_failed', 'warranty')),
  receipt_line_id TEXT NOT NULL REFERENCES receipt_lines (id),
  -- The returned piece a warranty claim is for.
  unit_id TEXT REFERENCES stock_units (id),
  -- One unit's price on the order, in the order's currency's smallest unit.
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  currency TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('drafted', 'sent', 'accepted', 'rejected', 'withdrawn')),
  outcome TEXT CHECK (outcome IN ('credit', 'replacement')),
  credit_amount INTEGER CHECK (credit_amount >= 0),
  note TEXT,
  drafted_by TEXT NOT NULL,
  drafted_at TEXT NOT NULL,
  sent_by TEXT,
  sent_at TEXT,
  decided_by TEXT,
  decided_at TEXT,
  change_id TEXT
);

CREATE INDEX supplier_claims_open ON supplier_claims (number) WHERE state IN ('drafted', 'sent');
CREATE INDEX supplier_claims_by_supplier ON supplier_claims (supplier_id);
CREATE UNIQUE INDEX supplier_claims_by_receipt_line ON supplier_claims (receipt_line_id, reason) WHERE unit_id IS NULL;
CREATE UNIQUE INDEX supplier_claims_by_unit ON supplier_claims (unit_id) WHERE unit_id IS NOT NULL;

-- The receipt line a piece came in on, found from its unit's first move.
CREATE INDEX receipt_lines_by_movement ON receipt_lines (movement_id) WHERE movement_id IS NOT NULL;

-- A returned piece handed in is settled once: claimed on its supplier, or written off with why.
ALTER TABLE piece_returns ADD COLUMN settled_at TEXT;
ALTER TABLE piece_returns ADD COLUMN settled_by TEXT;
ALTER TABLE piece_returns ADD COLUMN claim_id TEXT REFERENCES supplier_claims (id);
ALTER TABLE piece_returns ADD COLUMN write_off_reason TEXT;
-- The request that settled it, which what follows from the settlement is written under.
ALTER TABLE piece_returns ADD COLUMN settlement_id TEXT;

CREATE INDEX piece_returns_to_settle ON piece_returns (handed_in_at) WHERE handed_in_at IS NOT NULL AND settled_at IS NULL;
