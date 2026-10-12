-- What each hair system costs us, for the margin figures until stock lots carry what was paid (docs/decisions/0152-
-- standard-costs.md): Finance's figure per product, in paise before GST, from a day; a new figure never rewrites one.
CREATE TABLE standard_costs (
  item TEXT NOT NULL CHECK (item IN ('first_fit', 'replacement')),
  tier TEXT NOT NULL,
  cost INTEGER NOT NULL CHECK (cost >= 0),
  valid_from TEXT NOT NULL,
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL,
  PRIMARY KEY (item, tier, valid_from)
);
