-- Migration number: 0071
-- A visit ops book from the console that the client pays for: the slot is held, and a Razorpay payment link goes to
-- the client; the visit is booked once the link is paid.
--
-- New columns, 0 or empty on every hold there is: the Worker already deployed reads none of them, and every hold it
-- writes is paid at Checkout, free or on a credit, which is what their defaults say.

-- A hold ops made that the client pays for by a payment link, rather than at the app's Checkout.
ALTER TABLE slot_holds ADD COLUMN pay_by_link INTEGER NOT NULL DEFAULT 0 CHECK (pay_by_link IN (0, 1));

-- The link Razorpay made for it, and the address Razorpay texted the client.
ALTER TABLE slot_holds ADD COLUMN payment_link_id TEXT;
ALTER TABLE slot_holds ADD COLUMN payment_link_url TEXT;

CREATE UNIQUE INDEX slot_holds_by_payment_link ON slot_holds (payment_link_id) WHERE payment_link_id IS NOT NULL;
