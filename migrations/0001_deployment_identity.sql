-- Migration number: 0001
-- Records which environment's database this is. Migrations are identical in
-- every environment, so the row is written outside them, once per database, by
-- scripts/mark-database.ts. mm-api refuses to serve when the row disagrees with
-- its ENVIRONMENT. See docs/decisions/0003-environment-identity-guard.md.

CREATE TABLE deployment_identity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  database_name TEXT NOT NULL,
  marked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Once written, the identity never changes. A database that needs a different
-- identity is the wrong database.
CREATE TRIGGER deployment_identity_no_update
BEFORE UPDATE ON deployment_identity
BEGIN
  SELECT RAISE(ABORT, 'deployment_identity is immutable');
END;

CREATE TRIGGER deployment_identity_no_delete
BEFORE DELETE ON deployment_identity
BEGIN
  SELECT RAISE(ABORT, 'deployment_identity is immutable');
END;
