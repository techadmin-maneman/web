-- Money spent to win clients that no ad account reports (docs/decisions/0150-spend.md): a month's offline spend, for a
-- city or national, by channel, typed in on the console's Spend page. Rupees before GST, as paise; one taken off is kept.
CREATE TABLE spend_entries (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  city TEXT REFERENCES cities (name),
  channel TEXT NOT NULL,
  campaign TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  note TEXT,
  entered_by TEXT NOT NULL,
  entered_at TEXT NOT NULL,
  removed_by TEXT,
  removed_at TEXT
);

CREATE INDEX spend_entries_by_month ON spend_entries (month) WHERE removed_at IS NULL;
