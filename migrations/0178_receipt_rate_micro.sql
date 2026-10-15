-- A receipt's exchange rate in micro-rupees to one whole unit of the order's currency, beside rupee_rate's whole paise:
-- a paisa to the yen, or to the dong, was too coarse a step, and its price in the currency's smallest unit was assumed to
-- be hundredths (src/config/currencies.ts). The code reads rate_micro where it is set, and rupee_rate's paise until then.
ALTER TABLE receipts ADD COLUMN rate_micro INTEGER CHECK (rate_micro IS NULL OR rate_micro > 0);

-- backfill: every receipt, under 2,000 on either database and no index but the key: under 4,000 writes.
UPDATE receipts SET rate_micro = rupee_rate * 10000;
