-- Migration number: 0009
-- contract: docs/decisions/0042-client-profile.md
--
-- consents, rebuilt to allow Phase 2's five purposes as well as Phase 1's
-- three. SQLite cannot change a CHECK constraint in place. The consent record
-- is the legal record, so the purposes stay checked in the database, and the
-- table stays append-only: the triggers are recreated with it.
--
-- The code already deployed keeps working: it names only Phase 1's purposes,
-- which are still allowed. Every row is copied across unchanged.

PRAGMA defer_foreign_keys = true;

CREATE TABLE consents_v2 (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  purpose TEXT NOT NULL CHECK (purpose IN (
    -- Phase 1: agreements given on the public site.
    'contact', 'tryon_photo', 'result_delivery',
    -- Phase 2: each switched on or off by the client in the app, each with its own date.
    'photos_own_record', 'photos_referral_cards', 'photos_marketing', 'whatsapp_visits', 'whatsapp_launches'
  )),
  notice_version TEXT NOT NULL,
  granted INTEGER NOT NULL CHECK (granted IN (0, 1)),
  created_at TEXT NOT NULL,
  ip_hash TEXT
);

INSERT INTO consents_v2 (id, person_id, purpose, notice_version, granted, created_at, ip_hash)
SELECT id, person_id, purpose, notice_version, granted, created_at, ip_hash FROM consents;

DROP TABLE consents;
ALTER TABLE consents_v2 RENAME TO consents;

CREATE INDEX consents_by_person ON consents (person_id);

CREATE TRIGGER consents_no_update
BEFORE UPDATE ON consents
BEGIN
  SELECT RAISE(ABORT, 'consents are append-only');
END;

CREATE TRIGGER consents_no_delete
BEFORE DELETE ON consents
BEGIN
  SELECT RAISE(ABORT, 'consents are append-only');
END;
