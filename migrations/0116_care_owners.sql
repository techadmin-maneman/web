-- Each client's named Care person (docs/decisions/0131-care-people.md): given at the client's first chat to the Care
-- team member with the fewest clients, and moved by a Customer Care manager.
CREATE TABLE care_owners (
  person_id TEXT PRIMARY KEY REFERENCES people (id),
  -- The Care person, by the e-mail the Staff list names them by; one taken off the list keeps their clients until
  -- a manager moves them.
  email TEXT NOT NULL,
  since TEXT NOT NULL,
  -- "system" when given at the first chat; else the manager who moved the client.
  assigned_by TEXT NOT NULL
);

CREATE INDEX care_owners_by_email ON care_owners (email);
