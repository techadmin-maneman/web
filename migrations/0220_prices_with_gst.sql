-- Migration number: 0220
-- A price as ops set it: what the client pays, GST included (docs/decisions/0274-gst-on.md), with the figure before GST
-- worked out from it. A row the Worker already deployed adds leaves it empty, and is read from the figure before GST.

-- What the client pays, in paise, GST included.
ALTER TABLE price_book ADD COLUMN amount_paise INTEGER CHECK (amount_paise IS NULL OR amount_paise >= 0);
-- What the client pays in the city, in paise, GST included.
ALTER TABLE city_prices ADD COLUMN amount_paise INTEGER CHECK (amount_paise IS NULL OR amount_paise >= 0);

-- Each row so far gets the figure it already came to.
-- backfill: under 50 rows in price_book and none in city_prices on either database, x 2 with each key's index.
UPDATE price_book SET amount_paise = CAST(ROUND(amount_ex_gst * (100 + gst_percent) / 100.0) AS INTEGER);
UPDATE city_prices SET amount_paise = CAST(ROUND(amount_ex_gst * (100 + gst_percent) / 100.0) AS INTEGER);
