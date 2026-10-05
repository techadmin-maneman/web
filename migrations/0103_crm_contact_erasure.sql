-- Migration number: 0103
-- An erased client's CRM Contact, which Books' own CRM integration made of their Books customer (ADR 0110): its ID,
-- read from the customer before the customer goes, and the erasure of it, with the tries it took, as the Books
-- customer's erasure keeps its own. Expand only: the Worker already deployed reads none of it.

ALTER TABLE people ADD COLUMN crm_contact_id TEXT;
ALTER TABLE people ADD COLUMN crm_contact_erased_at TEXT;
ALTER TABLE people ADD COLUMN crm_contact_erasure_attempts INTEGER NOT NULL DEFAULT 0;

-- The pass (src/domain/books-erasure.ts): erased people whose CRM Contact is still to be erased.
CREATE INDEX people_crm_contact_erasure_due ON people (erased_at)
  WHERE crm_contact_id IS NOT NULL AND crm_contact_erased_at IS NULL;
