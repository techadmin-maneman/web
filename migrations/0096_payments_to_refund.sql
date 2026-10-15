-- Migration number: 0096
-- What the Tasks board's "Payment to refund" reads (src/domain/tasks.ts): a captured payment no visit took, whose hold
-- was let go without its refund, and a refund Razorpay failed. Both sets stay small, so each look reads only them.
--
-- Expand only: two indexes. The Worker already deployed reads neither.

CREATE INDEX payments_unbooked ON payments (razorpay_order_id) WHERE status = 'captured' AND appointment_id IS NULL;
CREATE INDEX refunds_failed ON refunds (payment_id) WHERE status = 'failed';
