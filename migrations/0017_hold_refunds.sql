-- Migration number: 0017
-- When a hold's payment was refunded (docs/decisions/0045-self-serve-booking.md):
-- set before the refund is asked for, so a repeated message cannot refund twice.
-- Only a new column, so the code already deployed is unaffected.

ALTER TABLE slot_holds ADD COLUMN refunded_at TEXT;
