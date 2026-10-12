-- Photographs of stock (docs/decisions/0170-stock-photos.md), each kept in the client-photos bucket under stock/ and
-- counted by the storage meter: a returned piece's when it is written off, which it must have, and a claim's when it
-- is sent, which it may.
ALTER TABLE piece_returns ADD COLUMN photo_id TEXT;
ALTER TABLE supplier_claims ADD COLUMN photo_id TEXT;
