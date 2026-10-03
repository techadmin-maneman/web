-- Migration number: 0077
-- An erased client's customer in Zoho Books, blanked or deleted by the Books erasure pass
-- (src/domain/books-erasure.ts), with the tries it took, as the CRM's and FSM's erasures keep theirs.
--
-- Expand only: the Worker already deployed reads nothing of it.

ALTER TABLE people ADD COLUMN books_erased_at TEXT;
ALTER TABLE people ADD COLUMN books_erasure_attempts INTEGER NOT NULL DEFAULT 0;

-- The pass: erased people whose Books customer is still to be erased.
CREATE INDEX people_books_erasure_due ON people (erased_at)
  WHERE erased_at IS NOT NULL AND books_customer_id IS NOT NULL AND books_erased_at IS NULL;
