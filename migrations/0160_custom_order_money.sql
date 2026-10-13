-- A custom order's money (src/domain/money/custom-order-refunds.ts, razorpay-catch-up.ts): when its refund was first
-- asked for, so a second press asks Razorpay as for one that may have been made; and when its unpaid link was last
-- asked about, so the hourly catch-up finds a payment the webhook missed.

ALTER TABLE custom_orders ADD COLUMN refund_asked_at TEXT;
ALTER TABLE custom_orders ADD COLUMN payment_checked_at TEXT;

-- The catch-up reads only the orders waiting on their link.
CREATE INDEX custom_orders_awaiting_payment ON custom_orders (link_sent_at)
  WHERE state = 'awaiting_payment' AND razorpay_link_id IS NOT NULL;
