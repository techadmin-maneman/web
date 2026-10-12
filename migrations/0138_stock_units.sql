-- Pieces as units (docs/decisions/0161-pieces-as-units.md): every hair system piece received is a unit with its own
-- label, followed from the warehouse to the client and back. The ledger keeps the counts; a unit says which piece.
-- A lot of a consumable gets a label for its boxes. Pieces held before labels stay in the ledger, unlabelled.
CREATE TABLE stock_units (
  id TEXT PRIMARY KEY,
  -- The label on the piece and in its QR code, e.g. MM-STA-0000123-K; a piece fitted keeps it as its piece code.
  code TEXT NOT NULL UNIQUE,
  serial INTEGER NOT NULL UNIQUE,
  consumable_code TEXT NOT NULL REFERENCES consumables (code),
  lot_id TEXT REFERENCES stock_lots (id),
  state TEXT NOT NULL CHECK (state IN ('held', 'in_transit', 'fitted', 'returned', 'written_off', 'missing')),
  -- The place holding it, or one in transit is going to; null once it has left the stock.
  place TEXT,
  transfer_id TEXT REFERENCES stock_transfers (id),
  -- The visit it was fitted on, or came off at.
  appointment_id TEXT,
  labelled_at TEXT NOT NULL,
  moved_at TEXT NOT NULL
);

CREATE INDEX stock_units_held ON stock_units (place, consumable_code) WHERE state = 'held';
CREATE INDEX stock_units_by_transfer ON stock_units (transfer_id) WHERE transfer_id IS NOT NULL;
CREATE INDEX stock_units_by_visit ON stock_units (appointment_id) WHERE appointment_id IS NOT NULL;

-- Each unit's history, only ever added to: the state it moved into, where, and by which movement.
CREATE TABLE stock_unit_events (
  unit_id TEXT NOT NULL REFERENCES stock_units (id),
  at TEXT NOT NULL,
  state TEXT NOT NULL,
  place TEXT,
  movement_id TEXT,
  transfer_id TEXT,
  appointment_id TEXT,
  actor TEXT NOT NULL
);

CREATE INDEX stock_unit_events_by_unit ON stock_unit_events (unit_id, at);

-- A lot's label, for its boxes: e.g. MM-LT-0000042-Q.
ALTER TABLE stock_lots ADD COLUMN label TEXT;
ALTER TABLE stock_lots ADD COLUMN label_serial INTEGER;

CREATE UNIQUE INDEX stock_lots_by_label ON stock_lots (label);
CREATE UNIQUE INDEX stock_lots_by_label_serial ON stock_lots (label_serial);
