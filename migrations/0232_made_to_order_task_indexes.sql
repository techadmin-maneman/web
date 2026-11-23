-- What the Tasks board's made-to-order queues read, never every order ever sent or piece ever received
-- (docs/decisions/0174-custom-orders.md): the purchase orders not yet sent to their supplier, drafted or approved, for
-- "Custom order to send"; and the pieces made for a custom order and held now, for "Custom fit to book".
-- backfill: none. Indexes only.

CREATE INDEX purchase_orders_unsent ON purchase_orders (drafted_at) WHERE state IN ('drafted', 'approved');
CREATE INDEX stock_units_custom_held ON stock_units (custom_order_id) WHERE state = 'held' AND custom_order_id IS NOT NULL;
