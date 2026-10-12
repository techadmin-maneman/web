-- The demand forecast (docs/decisions/0179-demand-forecast.md): run once each planning period, each run a row, and
-- each stock code's expected use in each city in each period of the horizon a line, with what each of its four layers
-- gave. And the calendar of uplifts ops keep, which the baseline layer reads.
CREATE TABLE forecast_runs (
  id TEXT PRIMARY KEY,
  -- India's date the run's first period starts on.
  run_on TEXT NOT NULL,
  period_days INTEGER NOT NULL CHECK (period_days > 0),
  horizon_periods INTEGER NOT NULL CHECK (horizon_periods > 0),
  -- The rates it learned: the share of clients due who book, and of consultations that become a first fit.
  due_rate REAL NOT NULL,
  fit_rate REAL NOT NULL,
  ran_at TEXT NOT NULL
);

CREATE INDEX forecast_runs_by_day ON forecast_runs (run_on);

CREATE TABLE forecast_lines (
  run_id TEXT NOT NULL REFERENCES forecast_runs (id),
  consumable_code TEXT NOT NULL,
  -- '' where the visits behind it name no city.
  city TEXT NOT NULL,
  period INTEGER NOT NULL CHECK (period >= 0),
  booked REAL NOT NULL,
  due REAL NOT NULL,
  pipeline REAL NOT NULL,
  baseline REAL NOT NULL,
  expected REAL NOT NULL,
  high REAL NOT NULL,
  PRIMARY KEY (run_id, consumable_code, city, period)
);

CREATE TABLE demand_events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- NULL for every city.
  city TEXT,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  uplift_percent INTEGER NOT NULL CHECK (uplift_percent BETWEEN -90 AND 500),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX demand_events_by_end ON demand_events (ends_on) WHERE deleted_at IS NULL;

-- The baseline's history: what each technician's kit used, read over its last periods.
CREATE INDEX stock_movements_used_by_day ON stock_movements (created_at) WHERE reason = 'used';

-- The due layer's learned rate: every piece that fell due, booked or not.
CREATE INDEX pieces_by_due ON pieces (replacement_due_at) WHERE replacement_due_at IS NOT NULL;
