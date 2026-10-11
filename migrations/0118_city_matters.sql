-- A matter Customer Care send to a client's city (docs/decisions/0135-city-matters.md): from a chat, with what the city
-- team need to know. It waits on the city's Tasks as a City matter until they close it with what was done
-- (task_closures, as task_group 'city_matter').
CREATE TABLE city_matters (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  conversation_id TEXT REFERENCES conversations (id),
  -- The client's city when it was sent, which decides whose Tasks it waits on.
  city TEXT NOT NULL,
  -- Care's words to the city team about the client; NULL once the client is erased.
  note TEXT,
  raised_by TEXT NOT NULL,
  raised_at TEXT NOT NULL
);

CREATE INDEX city_matters_by_person ON city_matters (person_id);
