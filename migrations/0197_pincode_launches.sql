-- Launches ops schedule (docs/decisions/0221-launches-scheduled-paused-and-checked.md): pincodes of one city served
-- from a day still to come, which the cron serves on the day as the console's own serve does, telling those waiting.
-- A launch is scheduled, then live or cancelled; nothing deletes one.
CREATE TABLE pincode_launches (
  id TEXT PRIMARY KEY,
  city TEXT NOT NULL REFERENCES cities (name),
  -- India's date the pincodes are served from.
  go_live_on TEXT NOT NULL CHECK (go_live_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  state TEXT NOT NULL CHECK (state IN ('scheduled', 'live', 'cancelled')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- When the cron served them, and how many it told.
  live_at TEXT,
  alerted INTEGER,
  cancelled_by TEXT,
  cancelled_at TEXT,
  -- Why the cron could not serve them on the day, kept while the launch waits for ops.
  held_because TEXT,
  CHECK ((state = 'live') = (live_at IS NOT NULL)),
  CHECK ((state = 'cancelled') = (cancelled_at IS NOT NULL))
);

CREATE INDEX pincode_launches_due ON pincode_launches (go_live_on) WHERE state = 'scheduled';

CREATE TABLE pincode_launch_pincodes (
  launch_id TEXT NOT NULL REFERENCES pincode_launches (id),
  pincode TEXT NOT NULL REFERENCES serviceable_pincodes (pincode),
  PRIMARY KEY (launch_id, pincode)
);

CREATE INDEX pincode_launch_pincodes_by_pincode ON pincode_launch_pincodes (pincode);

-- A pincode served but taking no new clients until this India date: the site and the app offer no consultation
-- there, and clients we already come to book as before. Null when it is not paused.
ALTER TABLE serviceable_pincodes ADD COLUMN paused_until TEXT
  CHECK (paused_until IS NULL OR paused_until GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
