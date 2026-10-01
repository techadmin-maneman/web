-- Migration number: 0063
-- contract: docs/decisions/0106-a-clients-hair-profile.md
--
-- A client's hair profile (docs/decisions/0106-a-clients-hair-profile.md): the
-- fit spec a piece is made to, and the history of what they have tried, by the
-- owner's ruling of 1 October 2026.
--
-- hair_profiles keeps every version. The technician's is keyed to the visit it
-- was taken at and to the phone's X-Client-Event-Id, so a replay of the same
-- write is refused by the unique index; ops' corrections name neither, and
-- name the member of staff instead. A version is never changed and never
-- deleted: the one change its trigger lets through is a column blanked, which
-- is what an erasure does, and a client withdrawing the consent to their
-- history. The codes (the stage, the colour, the wave and the rest) are not
-- checked here: their lists live in src/policy/hair-profile.ts, awaiting the
-- owner's words, and a CHECK could change only by rebuilding the table.
--
-- consents is rebuilt to take the history's own purpose, health_history: SQLite
-- cannot change a CHECK in place, and nothing references consents. Every row is
-- copied across unchanged, its rowid with it, since the code tells a person's
-- consents of one moment apart by their rowid. The table stays append-only:
-- its index and triggers are made again with it, as migration 0009 did.
--
-- The code already deployed names none of this, and writes consents as before.

PRAGMA defer_foreign_keys = true;

CREATE TABLE hair_profiles (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  appointment_id TEXT REFERENCES appointments (id),
  event_id TEXT,
  technician_id TEXT REFERENCES technicians (id),
  staff TEXT,
  created_at TEXT NOT NULL,
  -- The fit spec.
  norwood_stage TEXT,
  head_circumference_cm REAL,
  front_to_nape_cm REAL,
  ear_to_ear_cm REAL,
  temple_to_temple_cm REAL,
  base_width_in REAL,
  base_length_in REAL,
  colour TEXT,
  grey_percent INTEGER,
  density_percent INTEGER,
  wave TEXT,
  hairline TEXT,
  product TEXT,
  attachment TEXT,
  -- The history, recorded only with the client's consent to it (consents, purpose health_history).
  remedies TEXT,
  transplant_year INTEGER,
  skin_and_allergies TEXT,
  CHECK ((technician_id IS NULL) <> (staff IS NULL))
);

CREATE UNIQUE INDEX hair_profiles_by_event ON hair_profiles (appointment_id, event_id);

CREATE INDEX hair_profiles_by_person ON hair_profiles (person_id, created_at);

CREATE TRIGGER hair_profiles_only_blanked
BEFORE UPDATE ON hair_profiles
WHEN NEW.id IS NOT OLD.id OR NEW.person_id IS NOT OLD.person_id OR NEW.appointment_id IS NOT OLD.appointment_id
  OR NEW.event_id IS NOT OLD.event_id OR NEW.technician_id IS NOT OLD.technician_id OR NEW.staff IS NOT OLD.staff
  OR NEW.created_at IS NOT OLD.created_at
  OR (NEW.norwood_stage IS NOT NULL AND NEW.norwood_stage IS NOT OLD.norwood_stage)
  OR (NEW.head_circumference_cm IS NOT NULL AND NEW.head_circumference_cm IS NOT OLD.head_circumference_cm)
  OR (NEW.front_to_nape_cm IS NOT NULL AND NEW.front_to_nape_cm IS NOT OLD.front_to_nape_cm)
  OR (NEW.ear_to_ear_cm IS NOT NULL AND NEW.ear_to_ear_cm IS NOT OLD.ear_to_ear_cm)
  OR (NEW.temple_to_temple_cm IS NOT NULL AND NEW.temple_to_temple_cm IS NOT OLD.temple_to_temple_cm)
  OR (NEW.base_width_in IS NOT NULL AND NEW.base_width_in IS NOT OLD.base_width_in)
  OR (NEW.base_length_in IS NOT NULL AND NEW.base_length_in IS NOT OLD.base_length_in)
  OR (NEW.colour IS NOT NULL AND NEW.colour IS NOT OLD.colour)
  OR (NEW.grey_percent IS NOT NULL AND NEW.grey_percent IS NOT OLD.grey_percent)
  OR (NEW.density_percent IS NOT NULL AND NEW.density_percent IS NOT OLD.density_percent)
  OR (NEW.wave IS NOT NULL AND NEW.wave IS NOT OLD.wave)
  OR (NEW.hairline IS NOT NULL AND NEW.hairline IS NOT OLD.hairline)
  OR (NEW.product IS NOT NULL AND NEW.product IS NOT OLD.product)
  OR (NEW.attachment IS NOT NULL AND NEW.attachment IS NOT OLD.attachment)
  OR (NEW.remedies IS NOT NULL AND NEW.remedies IS NOT OLD.remedies)
  OR (NEW.transplant_year IS NOT NULL AND NEW.transplant_year IS NOT OLD.transplant_year)
  OR (NEW.skin_and_allergies IS NOT NULL AND NEW.skin_and_allergies IS NOT OLD.skin_and_allergies)
BEGIN
  SELECT RAISE(ABORT, 'a hair profile is never changed, only blanked');
END;

CREATE TRIGGER hair_profiles_no_delete
BEFORE DELETE ON hair_profiles
BEGIN
  SELECT RAISE(ABORT, 'a hair profile is kept: an erasure blanks it');
END;

CREATE TABLE consents_next (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  purpose TEXT NOT NULL CHECK (purpose IN (
    -- Phase 1: agreements given on the public site.
    'contact', 'tryon_photo', 'result_delivery',
    -- Phase 2: each switched on or off by the client in the app, each with its own date.
    'photos_own_record', 'photos_referral_cards', 'photos_marketing', 'whatsapp_visits', 'whatsapp_launches',
    -- The client's health history, asked for on the technician's phone (docs/decisions/0106-a-clients-hair-profile.md).
    'health_history'
  )),
  notice_version TEXT NOT NULL,
  granted INTEGER NOT NULL CHECK (granted IN (0, 1)),
  created_at TEXT NOT NULL,
  ip_hash TEXT,
  source TEXT
);

INSERT INTO consents_next (rowid, id, person_id, purpose, notice_version, granted, created_at, ip_hash, source)
SELECT rowid, id, person_id, purpose, notice_version, granted, created_at, ip_hash, source FROM consents;

DROP TABLE consents;

ALTER TABLE consents_next RENAME TO consents;

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
