-- Migration number: 0043
-- Hand-offs between surfaces, and the messages people are owed
-- (docs/decisions/0073-hand-offs-and-messages.md).

-- One arrival notice a visit, however often the technician checks in: the
-- no-show's evidence reads its receipt (src/domain/visit-messages.ts).
CREATE UNIQUE INDEX outbound_messages_one_arrival ON outbound_messages (subject_id) WHERE kind = 'arrival_notice';

-- The friend's first name, kept with the referral when it is granted, so the
-- referrer's tracker still reads it after the friend is erased rather than
-- "Erased" (src/routes/client-refer.ts). Filled here for the grants already
-- made to a friend not erased; one erased before now has no name to keep.
ALTER TABLE referral_attributions ADD COLUMN friend_first_name TEXT;
UPDATE referral_attributions
SET friend_first_name = (
  SELECT CASE WHEN instr(trim(p.name), ' ') > 0 THEN substr(trim(p.name), 1, instr(trim(p.name), ' ') - 1)
    ELSE trim(p.name) END
  FROM people p WHERE p.id = referral_attributions.referred_person_id AND p.erased_at IS NULL)
WHERE grant_state IN ('granted', 'approved');
