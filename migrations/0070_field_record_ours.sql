-- Migration number: 0070
-- contract: docs/decisions/0110-field-work-without-fsm.md
--
-- What a visit booked without FSM needs. The code already deployed reads none
-- of the new columns, and writes nothing the changed ones refuse.

-- The person's customer in Zoho Books, once the Books pass has made it.
ALTER TABLE people ADD COLUMN books_customer_id TEXT;
CREATE UNIQUE INDEX people_by_books_customer ON people (books_customer_id) WHERE books_customer_id IS NOT NULL;

-- The service's item in Zoho Books, once found by name or made.
ALTER TABLE services ADD COLUMN books_item_id TEXT;

-- A visit booked without FSM has no FSM status and no time FSM changed it, so
-- both may be empty. Many tables point at appointments, so each column is
-- swapped in place rather than the table rebuilt; no index, trigger or view
-- names either.
ALTER TABLE appointments ADD COLUMN fsm_status_next TEXT;
ALTER TABLE appointments ADD COLUMN fsm_modified_at_next TEXT;

UPDATE appointments SET fsm_status_next = fsm_status, fsm_modified_at_next = fsm_modified_at;

ALTER TABLE appointments DROP COLUMN fsm_status;
ALTER TABLE appointments DROP COLUMN fsm_modified_at;

ALTER TABLE appointments RENAME COLUMN fsm_status_next TO fsm_status;
ALTER TABLE appointments RENAME COLUMN fsm_modified_at_next TO fsm_modified_at;

-- Books gets a Zoho client of its own beside the CRM's and FSM's. A CHECK
-- cannot change in place, and nothing points at this table, so it is rebuilt
-- with every token and lease copied across.
CREATE TABLE zoho_access_tokens_next (
  client TEXT PRIMARY KEY CHECK (client IN ('crm', 'fsm', 'books')),
  access_token TEXT,
  expires_at TEXT,
  refreshing_until TEXT,
  cool_down_until TEXT
);

INSERT INTO zoho_access_tokens_next (client, access_token, expires_at, refreshing_until, cool_down_until)
SELECT client, access_token, expires_at, refreshing_until, cool_down_until FROM zoho_access_tokens;

DROP TABLE zoho_access_tokens;

ALTER TABLE zoho_access_tokens_next RENAME TO zoho_access_tokens;
