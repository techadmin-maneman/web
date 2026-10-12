-- Stock at risk (docs/decisions/0178-stock-at-risk.md): each fit booked in the weeks ahead whose hair system no place in
-- its city holds, or whose client has no profile to match one by, found each hour and cleared once it is no longer at
-- risk. It is a task on the board, never a block on the booking.
CREATE TABLE stock_risks (
  appointment_id TEXT PRIMARY KEY REFERENCES appointments (id),
  -- The stock code it needs; NULL where the client has no profile to match one by.
  consumable_code TEXT,
  city TEXT,
  found_at TEXT NOT NULL,
  cleared_at TEXT
);

CREATE INDEX stock_risks_open ON stock_risks (found_at) WHERE cleared_at IS NULL;
