-- Activity reads each call beside what the same request wrote (src/domain/ops/activity.ts): its own action, which it
-- stands for, or that it was refused. Only a new index, so the code already deployed is unaffected.
CREATE INDEX audit_log_by_request ON audit_log (request_id) WHERE request_id IS NOT NULL;
