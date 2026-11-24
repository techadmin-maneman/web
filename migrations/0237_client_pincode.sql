-- Migration number: 0237
-- The pincode ops ask on Add a client (docs/decisions/0307-the-people-rulings.md): the client's city until they
-- give an address, book or ask for a consultation. A new column: the Worker already deployed reads and writes none of it.

-- The pincode they told ops on the call; null where none was asked.
ALTER TABLE people ADD COLUMN pincode TEXT;

-- backfill: none. No pincode was asked before this migration, so each stays null.
