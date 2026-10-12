-- Transfers in transit (docs/decisions/0158-transfers-in-transit.md): stock sent to a warehouse, a hub or a stockroom
-- leaves its place when it is sent and arrives only when the other end receives it, in full or short; until then it
-- is in transit. One sent back before it arrives returns to where it left. Stock handed to a kit arrives at once.
CREATE TABLE stock_transfers (
  id TEXT PRIMARY KEY,
  consumable_code TEXT NOT NULL REFERENCES consumables (code),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  from_place TEXT NOT NULL REFERENCES stock_places (id),
  to_place TEXT NOT NULL REFERENCES stock_places (id),
  state TEXT NOT NULL CHECK (state IN ('in_transit', 'received', 'cancelled')),
  -- What arrived; short of the quantity sent where some was lost on the way.
  received_quantity INTEGER CHECK (received_quantity BETWEEN 0 AND quantity),
  -- Ops' own words on what arrived. Never a client's name.
  note TEXT,
  sent_by TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  settled_by TEXT,
  settled_at TEXT,
  -- The settling request's own token, which the rows written with the settlement test for.
  settlement_id TEXT,
  CHECK ((state = 'in_transit') = (settled_at IS NULL)),
  CHECK ((state = 'in_transit') = (settlement_id IS NULL)),
  CHECK ((state = 'received') = (received_quantity IS NOT NULL))
);

CREATE INDEX stock_transfers_in_transit ON stock_transfers (sent_at) WHERE state = 'in_transit';
