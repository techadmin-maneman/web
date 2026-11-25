-- Migration number: 0239
-- A lead lost, as ops record it on the client's page (docs/decisions/0320-lead-stages.md): why, the client's
-- objection in ops' words, and when; the audit log keeps who. Only new columns: the deployed code is unaffected.

-- Why it was lost: one of the job sheet's lost reasons, by its code (docs/decisions/0149-lost-reasons.md).
ALTER TABLE person_attribution ADD COLUMN lost_reason TEXT;
-- The client's objection, in ops' words.
ALTER TABLE person_attribution ADD COLUMN lost_objection TEXT;
-- When the lead was first recorded as lost; kept while it stays lost.
ALTER TABLE person_attribution ADD COLUMN lost_at TEXT;
