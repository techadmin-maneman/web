-- Migration number: 0018
-- The price book without GST from 22 September 2026: the owner switched GST
-- off in Books for staging, so billing works end to end there, and turns it
-- on for production with the real GSTIN and the CA's rates
-- (docs/open-points.md, items 2 and 3). The same prices; the rows before stay
-- for what was sold under them. Only new rows, so the code already deployed is
-- unaffected.

INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES
  ('consultation', 'standard', 0, 0, '2026-09-22'),
  ('first_fit', 'standard', 3000000, 0, '2026-09-22'),
  ('service', 'standard', 200000, 0, '2026-09-22'),
  ('replacement', 'standard', 1500000, 0, '2026-09-22'),
  ('late_fee_first_fit', 'standard', 400000, 0, '2026-09-22'),
  ('late_fee_replacement', 'standard', 300000, 0, '2026-09-22');
