-- Migration number: 0061
-- The reward a referral was settled under (docs/decisions/0107-referral-rewards-in-the-console.md): each side's
-- service visits and how many days they last, as ops had set them when the friend's first fit settled it. A grant
-- held for ops' review is given what was in force then, not what is in force on the day ops approve it.
--
-- Only new columns, all nullable. Null is a referral settled before rewards were kept, or by the Worker already
-- deployed, which reads none of them; such a grant takes the reward in force when it is given.

ALTER TABLE referral_attributions ADD COLUMN referrer_visits INTEGER CHECK (referrer_visits >= 0);
ALTER TABLE referral_attributions ADD COLUMN friend_visits INTEGER CHECK (friend_visits >= 0);
ALTER TABLE referral_attributions ADD COLUMN credit_valid_days INTEGER CHECK (credit_valid_days > 0);
