-- A vendor held off while it keeps failing, and each client's contact change still owed to their CRM lead, which the
-- sweeper sends again (docs/decisions/0203-a-vendor-down-is-held-off.md). Two new tables, which the deployed Worker
-- does not read.

CREATE TABLE vendor_breakers (
  vendor TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  open_until TEXT,
  opened_at TEXT
);

CREATE TABLE crm_contact_updates (
  person_id TEXT PRIMARY KEY REFERENCES people (id),
  owed_since TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  invite_attached INTEGER NOT NULL DEFAULT 0 CHECK (invite_attached IN (0, 1)),
  attempts INTEGER NOT NULL DEFAULT 0,
  tried_at TEXT
);
-- When the sweeper sends one again: a quarter hour after its last try, or after its last change since.
CREATE INDEX crm_contact_updates_due ON crm_contact_updates (COALESCE(tried_at, changed_at));
