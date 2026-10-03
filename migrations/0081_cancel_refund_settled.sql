-- Migration number: 0081
-- When a client's cancel was done with its refund: Razorpay made it, it was left to ops, who were told, or there was
-- nothing to give back. Null while the refund is owed; the cron's cancel_refunds job asks for it again under the
-- cancel's own receipt, so Razorpay makes it once.
--
-- Every change made before is taken as settled. The Worker already deployed writes none; a cancel it makes in the
-- meantime is asked for again by the job unless it carries a refund ID, and the receipt keeps that from refunding twice.

ALTER TABLE visit_changes ADD COLUMN refund_settled_at TEXT;

UPDATE visit_changes SET refund_settled_at = created_at;

CREATE INDEX visit_changes_refund_owed ON visit_changes (created_at)
  WHERE kind = 'cancelled' AND refund_settled_at IS NULL;
