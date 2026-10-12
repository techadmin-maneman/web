-- A custom order's piece reserved to its client (docs/decisions/0175-custom-pieces-reserved.md): the unit a receipt of
-- its order's line labels names the custom order, and never joins free stock.
ALTER TABLE stock_units ADD COLUMN custom_order_id TEXT REFERENCES custom_orders (id);

CREATE INDEX stock_units_reserved ON stock_units (custom_order_id) WHERE custom_order_id IS NOT NULL;

-- The units a movement labelled, found to reserve them.
CREATE INDEX stock_unit_events_by_movement ON stock_unit_events (movement_id) WHERE movement_id IS NOT NULL;
