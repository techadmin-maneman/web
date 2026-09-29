-- Migration number: 0057
-- contract: docs/decisions/0094-where-a-consent-was-given.md
--
-- Where each consent was given, and a check-in whose coordinates an erasure can
-- blank (docs/decisions/0094-where-a-consent-was-given.md).
--
-- consents.source names the place, from the closed set in
-- src/policy/consents.ts. A row written before this takes the place its notice
-- was shown in, where that notice was only ever shown in one. The rest stay
-- empty, and read "Not recorded": the consultation's and the waitlist's lines
-- are on /book and on an invite's page; the profile's switch also serves the
-- booking sheet and the share sheet, on the same notices; and the launch
-- alert's notice is shown by the waitlists as well as the profile. The code
-- already deployed leaves it empty too, until this release replaces it.
--
-- consents is append-only by trigger, so the trigger is lifted for the
-- backfill and put back as it was, in the same transaction.
--
-- checkins.lat and lng were NOT NULL, so an erasure could not blank where the
-- technician's phone was at the client's door (ADR 0025, ruling 34). They
-- become nullable. no_show_cases points at checkins, so each column is swapped
-- in place, as migrations 0031 and 0035 did, never rebuilt. The code already
-- deployed names its columns and always writes both.

ALTER TABLE consents ADD COLUMN source TEXT;

DROP TRIGGER consents_no_update;

UPDATE consents SET source = 'site_booking' WHERE notice_version = 'booking-v1';

UPDATE consents SET source = 'try_on' WHERE notice_version IN ('photo-v1', 'photo-v2', 'gate-v1', 'gate-v2');

UPDATE consents SET source = 'app_booking' WHERE notice_version IN (
  'photos-own-record-booking-v1', 'photos-referral-cards-booking-v1',
  'photos-own-record-booking-alone-v1', 'photos-referral-cards-booking-alone-v1'
);

UPDATE consents SET source = 'app_profile' WHERE notice_version IN ('photos-own-record-v1', 'photos-marketing-v1');

UPDATE consents SET source = 'erasure' WHERE notice_version = 'withdrawal';

CREATE TRIGGER consents_no_update
BEFORE UPDATE ON consents
BEGIN
  SELECT RAISE(ABORT, 'consents are append-only');
END;

ALTER TABLE checkins ADD COLUMN lat_next REAL;

ALTER TABLE checkins ADD COLUMN lng_next REAL;

UPDATE checkins SET lat_next = lat, lng_next = lng;

ALTER TABLE checkins DROP COLUMN lat;

ALTER TABLE checkins DROP COLUMN lng;

ALTER TABLE checkins RENAME COLUMN lat_next TO lat;

ALTER TABLE checkins RENAME COLUMN lng_next TO lng;
