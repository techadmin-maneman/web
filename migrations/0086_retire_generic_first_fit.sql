-- Migration number: 0086
-- A first fit is sold only as a hair system set up in the console. Migration 0050 seeded a generic "First fit" beside
-- them; it is retired here in every environment, from 2 October 2026, the day the owner ruled it out. What was sold
-- under it stays as sold, and its prices stay. The day is fixed so every database, a test's included, retires it alike.

UPDATE services
SET retired_date = '2026-10-02',
  updated_by = 'migrations/0086_retire_generic_first_fit.sql',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE kind = 'first_fit' AND tier = 'standard' AND (retired_date IS NULL OR retired_date > '2026-10-02');
