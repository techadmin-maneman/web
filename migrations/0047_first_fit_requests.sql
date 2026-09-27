-- Migration number: 0047
-- A first fit asked for on the site's booking form, with the consultation
-- (docs/decisions/0086-the-next-visit-is-offered.md; ADR 0025, item 68). The
-- form books the consultation, or asks for it while self-serve booking is off,
-- and writes this row in the same batch, so a booking refused leaves none. No
-- money is taken on the site: once the consultation is done, the app offers the
-- client the first fit, in the window they asked for, and the Tasks board lists
-- a fit asked for and still not booked some days later (First fit to book).
--
-- It points at people and not at leads, as consultation_requests does
-- (migration 0032): another table pointing at leads would narrow what a later
-- migration may do to that table. A new table, so the Worker already deployed
-- is unaffected.

CREATE TABLE first_fit_requests (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  -- The window the fit is wanted in, where one was given. A first fit takes two
  -- slots, which do not fit in the evening's (docs/decisions/0035-window-slot-map.md).
  preferred_window TEXT CHECK (preferred_window IN ('morning', 'afternoon')),
  created_at TEXT NOT NULL
);

-- A person's latest request stands: asking again replaces the one before.
CREATE UNIQUE INDEX first_fit_requests_by_person ON first_fit_requests (person_id);
