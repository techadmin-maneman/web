-- Migration number: 0005
-- The audit log: who did what to whose record, from which surface. Append-only:
-- the triggers below refuse every UPDATE and DELETE, so an entry once written
-- stays as written. Only a new table, so the code already deployed is
-- unaffected. See docs/decisions/0031-access-and-audit.md.
--
-- No name, mobile number or image reference is stored here. The actor is a
-- member of staff's e-mail or an opaque ID; the subject is an opaque ID.

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  surface TEXT NOT NULL CHECK (surface IN ('public', 'client', 'ops', 'tech')),
  -- staff: an Access login, by e-mail. service: an Access service token, by client ID.
  -- client, technician: by our own opaque ID. system: a scheduled job, by name.
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('staff', 'service', 'client', 'technician', 'system')),
  actor TEXT NOT NULL,
  -- e.g. ops.call, photo.view. The list is in src/domain/audit.ts, so a new action needs no migration.
  action TEXT NOT NULL,
  subject_kind TEXT,
  subject_id TEXT,
  request_id TEXT,
  -- A JSON object of IDs, counts and codes, never personal details.
  detail TEXT CHECK (detail IS NULL OR json_valid(detail)),
  CHECK ((subject_kind IS NULL) = (subject_id IS NULL))
);

CREATE INDEX audit_log_subject ON audit_log (subject_kind, subject_id, at);
CREATE INDEX audit_log_actor ON audit_log (actor_kind, actor, at);

CREATE TRIGGER audit_log_append_only_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER audit_log_append_only_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
