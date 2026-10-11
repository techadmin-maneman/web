-- What a technician is paid for each visit, beside their salary (docs/decisions/0122-technician-pay-per-visit.md):
-- the grades ops name for seniority, a grade on each technician, and a rate per grade and kind of visit, for every
-- city or for one, from a date. A rate is never rewritten: a new one starts from today or later, so a month already
-- worked is paid at the rates it was worked at.

CREATE TABLE pay_grades (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

ALTER TABLE technicians ADD COLUMN pay_grade_id TEXT REFERENCES pay_grades (id);

CREATE TABLE visit_pay_rates (
  id TEXT PRIMARY KEY,
  grade_id TEXT NOT NULL REFERENCES pay_grades (id),
  -- One city's rate, which stands in for every city's there; NULL for every city.
  city TEXT REFERENCES cities (name),
  visit_kind TEXT NOT NULL
    CHECK (visit_kind IN ('consultation', 'one_visit', 'first_fit', 'service', 'replacement', 'no_show')),
  -- Paise. NULL from this date: no rate of its own, so a city's falls back to every city's, and every city's to none.
  amount INTEGER CHECK (amount IS NULL OR amount >= 0),
  -- India's date it applies from.
  effective_from TEXT NOT NULL,
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL
);

CREATE UNIQUE INDEX visit_pay_rates_one_a_day ON visit_pay_rates (grade_id, coalesce(city, ''), visit_kind, effective_from);
