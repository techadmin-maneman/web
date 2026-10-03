-- Migration number: 0078
-- How far the pass that closes expired credits has got (src/domain/credits.ts), so it reads only the grants that
-- expired since instead of looking back a fixed week. It reads them by credit_ledger_grants_by_expiry (0037).
--
-- Expand only: a new table, empty. The Worker already deployed reads nothing of it.

-- One row, written by the pass once it first closes a grant.
CREATE TABLE credit_expiry_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  -- Every grant that expired before this has its expire entry; the pass reads from here.
  open_from_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
