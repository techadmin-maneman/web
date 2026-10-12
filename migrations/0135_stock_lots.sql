-- Lots and expiry (docs/decisions/0157-lots-and-expiry.md): a delivery brings a lot of a stock code, with the supplier's
-- lot and the day it expires, and each movement is broken down by the lots it moved, soonest to expire first, so each
-- place knows what it holds of each lot. A stock code's shelf life gives a lot its expiry when the supplier names none.
-- The ledger's rows and balances stay as they are; stock moved before lots, or of no known lot, has none.
ALTER TABLE consumables ADD COLUMN shelf_life_days INTEGER CHECK (shelf_life_days > 0);

CREATE TABLE stock_lots (
  id TEXT PRIMARY KEY,
  consumable_code TEXT NOT NULL REFERENCES consumables (code),
  -- The supplier's lot, as printed, or the day it was received where it carries none.
  lot_code TEXT NOT NULL,
  -- India's date it expires on; null for one that does not.
  expires_on TEXT,
  received_at TEXT NOT NULL,
  UNIQUE (consumable_code, lot_code)
);

-- What each movement moved of each lot. Its place is the movement's, as the balances name it.
CREATE TABLE stock_lot_moves (
  movement_id TEXT NOT NULL REFERENCES stock_movements (id),
  lot_id TEXT NOT NULL REFERENCES stock_lots (id),
  place TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity <> 0),
  PRIMARY KEY (movement_id, lot_id)
);

-- What each place holds of each lot: the sum of its moves, kept by the triggers below.
CREATE TABLE stock_lot_balances (
  lot_id TEXT NOT NULL REFERENCES stock_lots (id),
  place TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  PRIMARY KEY (lot_id, place)
);

CREATE INDEX stock_lot_balances_by_place ON stock_lot_balances (place, lot_id);

CREATE TRIGGER stock_lot_moves_balance AFTER INSERT ON stock_lot_moves
BEGIN
  INSERT INTO stock_lot_balances (lot_id, place, quantity) VALUES (NEW.lot_id, NEW.place, NEW.quantity)
  ON CONFLICT (lot_id, place) DO UPDATE SET quantity = stock_lot_balances.quantity + excluded.quantity;
END;

CREATE TRIGGER stock_lot_moves_taken_out AFTER DELETE ON stock_lot_moves
BEGIN
  UPDATE stock_lot_balances SET quantity = quantity - OLD.quantity WHERE lot_id = OLD.lot_id AND place = OLD.place;
END;
