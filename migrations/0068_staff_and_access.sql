-- Migration number: 0068
-- Who may do what in the ops console. Each member of staff is listed by their Cloudflare Access e-mail, with grants
-- of a department at a level over a place: national, a zone of cities, or one city. Service tokens keep the access
-- every caller had before, by an explicit list. One row says whether the console enforces any of it yet, and it
-- starts off. Only new tables and one new column, so the code already deployed is unaffected.

-- A zone is a region made of cities, as NCR is.
CREATE TABLE zones (
  name TEXT PRIMARY KEY,
  sort INTEGER NOT NULL
);

INSERT INTO zones (name, sort) VALUES ('NCR', 10);

-- NULL for a city in no zone yet, which only a national grant or a grant of that city reaches.
ALTER TABLE cities ADD COLUMN zone TEXT REFERENCES zones (name);

UPDATE cities SET zone = 'NCR' WHERE name IN ('Delhi', 'Gurgaon', 'Noida', 'Ghaziabad', 'Faridabad');

CREATE TABLE staff (
  -- In lower case, as the Worker reads it from the Access token.
  email TEXT PRIMARY KEY CHECK (email = lower(email) AND instr(email, '@') > 1),
  -- 0: kept on the list, with their grants, but let in nowhere.
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL,
  changed_by TEXT,
  changed_at TEXT
);

CREATE TABLE staff_grants (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL REFERENCES staff (email),
  department TEXT NOT NULL CHECK (department IN ('operations', 'customer_care', 'finance', 'growth', 'admin')),
  -- view < act < manage: each level can do what the ones before it can.
  level TEXT NOT NULL CHECK (level IN ('view', 'act', 'manage')),
  geography TEXT NOT NULL CHECK (geography IN ('national', 'zone', 'city')),
  -- The zone's or the city's name; NULL for national, which names no place.
  place TEXT,
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  CHECK ((geography = 'national') = (place IS NULL))
);

CREATE INDEX staff_grants_by_email ON staff_grants (email);

-- An Access service token let in as every caller was before the Staff list, such as CI's.
CREATE TABLE staff_service_tokens (
  -- What Access sends as the token's common name.
  client_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL
);

CREATE TABLE staff_access_mode (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  -- 0: nothing is refused, and what would have been is logged. 1: the Staff list decides.
  enforced INTEGER NOT NULL CHECK (enforced IN (0, 1)),
  set_by TEXT,
  set_at TEXT
);

INSERT INTO staff_access_mode (id, enforced) VALUES (1, 0);

-- Nobody who has used the console is locked out: each person in its audit log is listed with every department at
-- MANAGE, nationally, and each service token in it keeps its access. A service token is never listed as a person.
INSERT INTO staff (email, active, added_by, added_at)
  SELECT DISTINCT lower(actor), 1, 'migration 0068', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM audit_log
  WHERE surface = 'ops' AND actor_kind = 'staff' AND instr(actor, '@') > 1;

INSERT INTO staff_grants (email, department, level, geography, place, granted_by, granted_at)
  SELECT staff.email, departments.name, 'manage', 'national', NULL, 'migration 0068', staff.added_at
  FROM staff
  CROSS JOIN (
    SELECT 'operations' AS name
    UNION ALL SELECT 'customer_care'
    UNION ALL SELECT 'finance'
    UNION ALL SELECT 'growth'
    UNION ALL SELECT 'admin'
  ) AS departments;

INSERT INTO staff_service_tokens (client_id, label, added_by, added_at)
  SELECT DISTINCT actor, 'In use before the Staff list', 'migration 0068', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM audit_log
  WHERE surface = 'ops' AND actor_kind = 'service';
