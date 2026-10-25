-- Demand (docs/decisions/0224-demand-and-the-next-to-open.md): how often each pincode we do not serve is looked up on
-- the site, a day at a time, the pincode and a count, with nobody's data. Areas ranks the next to open by it.
CREATE TABLE pincode_demand (
  pincode TEXT NOT NULL CHECK (pincode GLOB '[1-9][0-9][0-9][0-9][0-9][0-9]'),
  -- India's date.
  day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  checks INTEGER NOT NULL CHECK (checks > 0),
  PRIMARY KEY (pincode, day)
);

CREATE INDEX pincode_demand_by_day ON pincode_demand (day);
