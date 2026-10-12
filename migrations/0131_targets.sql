-- A month's target for a city, by measure, set on the console's Targets page (docs/decisions/0154-targets-and-reporting-
-- access.md): what every scorecard sets plan beside actual. A count, whole rupees before GST, or a percentage.
CREATE TABLE targets (
  month TEXT NOT NULL,
  city TEXT NOT NULL REFERENCES cities (name),
  measure TEXT NOT NULL,
  target INTEGER NOT NULL CHECK (target >= 0),
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL,
  PRIMARY KEY (month, city, measure)
);
