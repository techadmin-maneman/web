-- Migration number: 0120
-- contract: docs/decisions/0138-strangers-in-the-inbox.md
-- leads.source gains 'whatsapp', swapped in place as in 0031 so leads is never dropped; the column keeps its name and
-- answers, and the one index that reads it is made again as it was.
-- backfill: under 500 leads on either database, × 6 with its indexes: about 3,000 writes.

DROP INDEX leads_fsm_unqueued;

ALTER TABLE leads ADD COLUMN source_next TEXT CHECK (source_next IN ('form', 'waitlist', 'tryon', 'whatsapp'));

UPDATE leads SET source_next = source;

ALTER TABLE leads DROP COLUMN source;

ALTER TABLE leads RENAME COLUMN source_next TO source;

CREATE INDEX leads_fsm_unqueued ON leads (created_at)
  WHERE fsm_queued_at IS NULL AND fsm_request_id IS NULL AND source = 'form' AND first_choice_window IS NOT NULL;
