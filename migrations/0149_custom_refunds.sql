-- A custom order refunded in full (docs/decisions/0176-custom-order-refunds.md): before its purchase order went out,
-- once its supplier was late past the grace ops set, or once its piece failed its check. Never once the client
-- changes their mind after the order has gone.
ALTER TABLE custom_orders ADD COLUMN refund_reason TEXT CHECK (refund_reason IN ('not_ordered', 'late', 'failed_check'));
ALTER TABLE custom_orders ADD COLUMN razorpay_refund_id TEXT;
ALTER TABLE custom_orders ADD COLUMN refunded_at TEXT;
