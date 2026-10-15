-- A paid visit ops booked while online payment is off: nothing is taken at booking, the client pays by UPI at the
-- visit, and ops record the payment once it reaches the account (docs/decisions/0208-paid-at-the-visit-by-upi.md).
ALTER TABLE slot_holds ADD COLUMN pay_at_visit INTEGER NOT NULL DEFAULT 0 CHECK (pay_at_visit IN (0, 1));

-- The holds paid at the visit, by the visit they booked: Tasks' "UPI to record" and the board's and the technician's
-- badge read only these, however many visits there are.
CREATE INDEX slot_holds_pay_at_visit ON slot_holds (appointment_id) WHERE pay_at_visit = 1 AND state = 'booked';
