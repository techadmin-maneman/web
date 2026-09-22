-- Migration number: 0022
-- A hold paid for with a service-visit credit instead of money (docs/decisions/0033-credit-ledger.md,
-- "Spending"): its visit redeems a credit once booked. Only a new column, so the code already deployed is
-- unaffected.

ALTER TABLE slot_holds ADD COLUMN use_credit INTEGER NOT NULL DEFAULT 0 CHECK (use_credit IN (0, 1));
