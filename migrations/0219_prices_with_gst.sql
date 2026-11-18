-- Migration number: 0219
-- A price as ops set it: what the client pays, GST included (docs/decisions/0274-gst-on.md). The figure before GST is
-- worked out from it, so a round price stays round at any rate. Each row so far gets the figure it already came to. A
-- row the Worker already deployed adds leaves it empty, and its figure is then worked out from the one before GST, as
-- before.
ALTER TABLE price_book ADD COLUMN amount INTEGER CHECK (amount IS NULL OR amount >= 0);
ALTER TABLE city_prices ADD COLUMN amount INTEGER CHECK (amount IS NULL OR amount >= 0);

UPDATE price_book SET amount = CAST(ROUND(amount_ex_gst * (100 + gst_percent) / 100.0) AS INTEGER);
UPDATE city_prices SET amount = CAST(ROUND(amount_ex_gst * (100 + gst_percent) / 100.0) AS INTEGER);
