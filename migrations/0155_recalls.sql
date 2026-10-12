-- Recalls (docs/decisions/0187-recalls.md): a lot blocked everywhere in one action, with where its stock is and who
-- wears its pieces, each of those pieces made due for replacement on the day.
CREATE TABLE recalls (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  lot_id TEXT NOT NULL REFERENCES stock_lots (id),
  reason TEXT NOT NULL,
  raised_by TEXT NOT NULL,
  raised_at TEXT NOT NULL,
  closed_by TEXT,
  closed_at TEXT
);

CREATE UNIQUE INDEX recalls_one_open ON recalls (lot_id) WHERE closed_at IS NULL;

-- When a lot was recalled; it stays blocked after its recall is closed.
ALTER TABLE stock_lots ADD COLUMN recalled_at TEXT;

-- Each fitted piece a recall made due, and the day it was due before.
CREATE TABLE recall_pieces (
  recall_id TEXT NOT NULL REFERENCES recalls (id),
  -- No foreign key: a client's pieces go with them when they are erased, and reads leave such a row out.
  piece_id TEXT NOT NULL,
  due_before TEXT,
  PRIMARY KEY (recall_id, piece_id)
);

-- A lot's pieces, wherever they are, for its recall.
CREATE INDEX stock_units_by_lot ON stock_units (lot_id) WHERE lot_id IS NOT NULL;
