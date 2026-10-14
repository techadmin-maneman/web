-- A vendor held off while it keeps failing, and each client's contact change still owed to their CRM lead, which the
-- sweeper sends again (docs/decisions/0203-a-vendor-down-is-held-off.md). Two new tables, which the deployed Worker
-- does not read.

CREATE TABLE vendor_breakers (
  vendor TEXT PRIMARY KEY, -- "crm"
  failures INTEGER NOT NULL DEFAULT 0, -- the vendor's own failures in a row, its refusals of a record not among them
  reopens_at TEXT, -- the instant its work may be tried again; empty while it is not held
  opened_at TEXT -- the instant the hold that is open, or the run of them, began
);

CREATE TABLE crm_contact_updates (
  person_id TEXT PRIMARY KEY REFERENCES people (id),
  owed_at TEXT NOT NULL, -- the instant the oldest change the lead does not have was made
  changed_at TEXT NOT NULL, -- the instant of the latest change, which a sent update must cover
  invite_attached INTEGER NOT NULL DEFAULT 0 CHECK (invite_attached IN (0, 1)), -- 1 once ops attached an invite
  attempts INTEGER NOT NULL DEFAULT 0, -- tries that did not reach the lead
  tried_at TEXT -- the instant of the last of them; empty since the latest change
);
-- When the sweeper sends one again: a quarter hour after its last try, or after its last change since.
CREATE INDEX crm_contact_updates_due ON crm_contact_updates (COALESCE(tried_at, changed_at));
