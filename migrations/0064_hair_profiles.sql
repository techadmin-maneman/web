-- Migration number: 0064
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
-- is what an erasure does. The codes (the stage, the colour, the wave and the
-- rest) are not checked here: their lists live in src/policy/hair-profile.ts,
-- awaiting the owner's words, and a CHECK could change only by rebuilding the
-- table. Expand only: the code already deployed names none of it.

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
  -- The history: remedies tried (a JSON array of codes), a transplant's year, skin conditions and allergies.
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
