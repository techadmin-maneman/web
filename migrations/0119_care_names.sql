-- The first name each of the Care team is known by to clients (docs/decisions/0136-care-names.md), as a Customer Care
-- manager sets it: the app's Support card names the client's Care person by it. Staff are otherwise known by e-mail,
-- which no client sees.
CREATE TABLE care_names (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL
);
