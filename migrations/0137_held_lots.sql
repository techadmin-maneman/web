-- The lots each place holds some of (docs/decisions/0159-stock-views-and-expiry.md), which the morning look at what
-- expires reads: every lot ever received stays in the balances, most of them used up, and this keeps to the rest.
CREATE INDEX stock_lot_balances_held ON stock_lot_balances (lot_id, place) WHERE quantity > 0;
