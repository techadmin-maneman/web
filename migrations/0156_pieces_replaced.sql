-- A piece taken off at a replacement is marked replaced, apart from one that failed, so it no longer reads as worn;
-- a worn piece with a later one fitted for the same client is marked replaced as that one was recorded
-- (docs/decisions/0191-a-replaced-piece-comes-off.md). A piece's recalls are found by the piece, for what a client
-- is owed free (docs/decisions/0192-free-remakes.md).
ALTER TABLE pieces ADD COLUMN replaced_at TEXT;

CREATE INDEX recall_pieces_by_piece ON recall_pieces (piece_id);

UPDATE pieces SET replaced_at = (
  SELECT MIN(n.synced_at) FROM pieces n
   WHERE n.person_id = pieces.person_id AND n.deleted_at IS NULL AND n.fitted_at > pieces.fitted_at)
WHERE deleted_at IS NULL AND failed_at IS NULL AND fitted_at IS NOT NULL AND person_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM pieces n
               WHERE n.person_id = pieces.person_id AND n.deleted_at IS NULL AND n.fitted_at > pieces.fitted_at);
