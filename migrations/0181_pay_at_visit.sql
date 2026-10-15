-- A paid visit ops booked while online payment is off: nothing is taken at booking, the client pays by UPI at the
-- visit, and ops record the payment once it reaches the account (docs/decisions/0208-paid-at-the-visit-by-upi.md).
ALTER TABLE slot_holds ADD COLUMN pay_at_visit INTEGER NOT NULL DEFAULT 0 CHECK (pay_at_visit IN (0, 1));
