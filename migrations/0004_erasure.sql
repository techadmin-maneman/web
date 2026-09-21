-- Migration number: 0004
-- Erasure. A person erased on request has their name, e-mail and number
-- blanked here at once (people.erased_at). Zoho is then updated by the
-- crm-sync queue; these columns track that until it is done, so the sweeper
-- can retry it. Only new columns, so the code already deployed is unaffected.
-- See docs/decisions/0019-erasure.md.

ALTER TABLE people ADD COLUMN crm_erased_at TEXT;
ALTER TABLE people ADD COLUMN crm_erasure_attempts INTEGER NOT NULL DEFAULT 0;
-- A provider status and code only, never the person's details.
ALTER TABLE people ADD COLUMN crm_erasure_error TEXT;
