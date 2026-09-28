-- Migration number: 0051
-- An invite ops attach to a client on the client's page, for a friend who
-- booked away from the invite's own page (docs/decisions/0089-an-invite-is-not-lost.md):
-- who attached it, by their Access identity, and why, in their own words. Both
-- stay empty for an invite the friend used themselves. The reason is kept here,
-- beside the attribution, and not in the audit log, which holds IDs and codes
-- only and is never blanked (ADR 0031); an erasure blanks it, as it does a
-- review's reason. Only nullable columns are added, so the Worker already
-- deployed is unaffected.

ALTER TABLE referral_attributions ADD COLUMN attached_by TEXT;
ALTER TABLE referral_attributions ADD COLUMN attach_reason TEXT;
