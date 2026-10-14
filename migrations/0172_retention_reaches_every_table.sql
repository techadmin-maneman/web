-- Retention for the tables that only grew (src/policy/retention.ts): the hourly retention job deletes resolved alerts,
-- Razorpay's event IDs, the closed chats of numbers we never knew, old sent messages and the audit log past its two
-- years, each oldest first through the index below. The deployed code deletes none of them, so nothing it does changes.

CREATE INDEX alerts_resolved ON alerts (resolved_at) WHERE resolved_at IS NOT NULL;
CREATE INDEX razorpay_events_by_received ON razorpay_events (received_at);
CREATE INDEX outbound_messages_by_created ON outbound_messages (created_at);
CREATE INDEX audit_log_by_at ON audit_log (at);

-- The audit log stays append-only for its two years; a row older than that may go, and nothing else.
DROP TRIGGER audit_log_append_only_delete;
CREATE TRIGGER audit_log_append_only_delete BEFORE DELETE ON audit_log
WHEN OLD.at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 years')
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only for two years');
END;
