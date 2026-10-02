-- Migration number: 0072
-- The line beside the invite that told the friend their referrer hears of their fit, as the page showed it
-- (src/config/notices.ts, TOLD_NOTICES). Null where the friend saw none: an invite ops attached, one whose page
-- could not show it, and every attribution made before this was recorded. Only a nullable column is added, so the
-- Worker already deployed is unaffected.

ALTER TABLE referral_attributions ADD COLUMN told_notice TEXT;
