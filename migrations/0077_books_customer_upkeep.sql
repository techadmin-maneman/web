-- Migration number: 0077
-- Without FSM, the client's customer in Zoho Books is ours to keep up to date: a new number or address written to
-- it, and an erased client's customer blanked or deleted. Expand only: the Worker already deployed reads none of it.

-- The Books erasure pass (src/domain/books-erasure.ts), with the tries it took, as the CRM's and FSM's erasures keep
-- theirs.
ALTER TABLE people ADD COLUMN books_erased_at TEXT;
ALTER TABLE people ADD COLUMN books_erasure_attempts INTEGER NOT NULL DEFAULT 0;

-- The pass: erased people whose Books customer is still to be erased.
CREATE INDEX people_books_erasure_due ON people (erased_at)
  WHERE erased_at IS NOT NULL AND books_customer_id IS NOT NULL AND books_erased_at IS NULL;

-- When the client's number or address last changed, until the Books pass has written it to their customer.
ALTER TABLE people ADD COLUMN books_details_changed_at TEXT;

-- The Books pass: clients whose customer is still to be told of a change.
CREATE INDEX people_books_update_due ON people (books_details_changed_at)
  WHERE books_details_changed_at IS NOT NULL AND books_customer_id IS NOT NULL AND erased_at IS NULL;
