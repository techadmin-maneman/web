-- Drive times learned from our own drives (docs/decisions/0294-learned-drive-times.md): for each city, weekday or
-- weekend, and hour a drive sets off in, the middle drive's time as a per cent of its estimate, how many drives stand
-- behind it, and when it was learned. The nightly job writes each city's groups afresh; a group with too few drives is
-- kept, counted, and not used until it has enough.
-- backfill: none. The first night's run learns from the drives already done.

CREATE TABLE drive_factors (
  city TEXT NOT NULL,
  day_kind TEXT NOT NULL CHECK (day_kind IN ('weekday', 'weekend')),
  hour INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  factor_pct INTEGER NOT NULL CHECK (factor_pct > 0),
  drives INTEGER NOT NULL CHECK (drives > 0),
  learned_at TEXT NOT NULL,
  PRIMARY KEY (city, day_kind, hour)
);
