-- How right the forecast was (docs/decisions/0183-forecast-accuracy.md): each run's first period, once it has passed,
-- each stock code and city's expected use and high case beside what the kits used. Kept after the run is let go, so
-- it names its period itself.
CREATE TABLE forecast_accuracy (
  run_id TEXT NOT NULL,
  consumable_code TEXT NOT NULL,
  -- '' where the use behind it names no city.
  city TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_days INTEGER NOT NULL CHECK (period_days > 0),
  expected REAL NOT NULL,
  high REAL NOT NULL,
  actual REAL NOT NULL,
  measured_at TEXT NOT NULL,
  PRIMARY KEY (run_id, consumable_code, city)
);

CREATE INDEX forecast_accuracy_by_city ON forecast_accuracy (city, period_start);

-- When a run was measured, so one whose period used nothing it expected is measured once all the same.
ALTER TABLE forecast_runs ADD COLUMN measured_at TEXT;

CREATE INDEX forecast_runs_unmeasured ON forecast_runs (run_on) WHERE measured_at IS NULL;
