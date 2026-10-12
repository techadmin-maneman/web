-- Where stock is kept, as a tree (docs/decisions/0155-the-stock-place-tree.md): the national warehouse, zone hubs, city
-- stockrooms and technicians' kits. The warehouse keeps the central store's ID and each kit its technician's, so the
-- ledger's rows and balances read as before; a row at a hub or a stockroom names it in place_id.
-- backfill: a kit for each technician, under 200 on either database, × 3 with its indexes: under 600 writes.
CREATE TABLE stock_places (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('warehouse', 'hub', 'stockroom', 'kit')),
  -- A kit is named by its technician.
  name TEXT,
  parent_id TEXT REFERENCES stock_places (id),
  -- A hub's zone; a stockroom's city. A kit is in its technician's city.
  zone TEXT REFERENCES zones (name),
  city TEXT REFERENCES cities (name),
  -- A kit's technician, whose ID it shares. No foreign key: the code before this release deletes a technician added
  -- by mistake without knowing of kits, so a kit can outlive its technician, and reads leave such a kit out.
  technician_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK ((kind = 'kit') = (technician_id IS NOT NULL)),
  CHECK ((kind = 'warehouse') = (parent_id IS NULL)),
  CHECK (kind <> 'hub' OR zone IS NOT NULL),
  CHECK (kind <> 'stockroom' OR city IS NOT NULL),
  CHECK (kind = 'kit' OR name IS NOT NULL)
);

CREATE INDEX stock_places_by_parent ON stock_places (parent_id);

INSERT INTO stock_places (id, kind, name, created_by, created_at)
VALUES ('central', 'warehouse', 'National warehouse', 'migrations/0133_stock_places.sql',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO stock_places (id, kind, parent_id, technician_id, created_by, created_at)
SELECT id, 'kit', 'central', id, 'migrations/0133_stock_places.sql', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM technicians;

-- Every technician has a kit from the day they are added, under the warehouse until ops move it.
CREATE TRIGGER technicians_kit AFTER INSERT ON technicians
BEGIN
  INSERT OR IGNORE INTO stock_places (id, kind, parent_id, technician_id, created_by, created_at)
  VALUES (NEW.id, 'kit', 'central', NEW.id, 'technicians', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

-- A hub's or a stockroom's row names it; the warehouse's and a kit's leave it null, as every row before.
ALTER TABLE stock_movements ADD COLUMN place_id TEXT REFERENCES stock_places (id);

DROP TRIGGER stock_movements_balance;
CREATE TRIGGER stock_movements_balance AFTER INSERT ON stock_movements
BEGIN
  INSERT INTO stock_balances (consumable_code, place, quantity, counted_at)
  VALUES (NEW.consumable_code, COALESCE(NEW.place_id, NEW.technician_id, 'central'), NEW.quantity,
          iif(NEW.reason = 'counted', NEW.created_at, NULL))
  ON CONFLICT (consumable_code, place) DO UPDATE SET
    quantity = stock_balances.quantity + excluded.quantity,
    counted_at = iif(stock_balances.counted_at IS NULL OR excluded.counted_at > stock_balances.counted_at,
                     excluded.counted_at, stock_balances.counted_at);
END;

DROP TRIGGER stock_movements_taken_out;
CREATE TRIGGER stock_movements_taken_out AFTER DELETE ON stock_movements
BEGIN
  UPDATE stock_balances
     SET quantity = quantity - OLD.quantity,
         counted_at = (SELECT MAX(m.created_at) FROM stock_movements m
                        WHERE COALESCE(m.place_id, m.technician_id, 'central')
                                = COALESCE(OLD.place_id, OLD.technician_id, 'central')
                          AND m.consumable_code = OLD.consumable_code AND m.reason = 'counted')
   WHERE consumable_code = OLD.consumable_code AND place = COALESCE(OLD.place_id, OLD.technician_id, 'central');
END;
