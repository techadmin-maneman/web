-- Migration number: 0202
-- contract: docs/decisions/0240-consultation-rules-and-inches.md
-- A consultation uses nothing from the kit, so what it was expected to use goes; the running Worker reads that as a
-- consultation expected to use nothing. The head is measured in inches, in four new columns filled from the
-- centimetres, which stay until a release has run without them.

DELETE FROM consumable_usage WHERE visit_type = 'consultation';

ALTER TABLE hair_profiles ADD COLUMN head_circumference_in REAL;
ALTER TABLE hair_profiles ADD COLUMN front_to_nape_in REAL;
ALTER TABLE hair_profiles ADD COLUMN ear_to_ear_in REAL;
ALTER TABLE hair_profiles ADD COLUMN temple_to_temple_in REAL;

-- backfill: one write a version of a client's profile, a few hundred at most, each × 3 with the table's two indexes.
UPDATE hair_profiles SET
  head_circumference_in = ROUND(head_circumference_cm / 2.54, 1),
  front_to_nape_in = ROUND(front_to_nape_cm / 2.54, 1),
  ear_to_ear_in = ROUND(ear_to_ear_cm / 2.54, 1),
  temple_to_temple_in = ROUND(temple_to_temple_cm / 2.54, 1);

-- A version is only ever blanked (migration 0064): the trigger, which watched only the old columns while they were
-- filled, now watches the inch columns too.
DROP TRIGGER hair_profiles_only_blanked;

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
  OR (NEW.head_circumference_in IS NOT NULL AND NEW.head_circumference_in IS NOT OLD.head_circumference_in)
  OR (NEW.front_to_nape_in IS NOT NULL AND NEW.front_to_nape_in IS NOT OLD.front_to_nape_in)
  OR (NEW.ear_to_ear_in IS NOT NULL AND NEW.ear_to_ear_in IS NOT OLD.ear_to_ear_in)
  OR (NEW.temple_to_temple_in IS NOT NULL AND NEW.temple_to_temple_in IS NOT OLD.temple_to_temple_in)
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
