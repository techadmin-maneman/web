-- How the client told Care they found us, for a lead Care saved from a chat (docs/decisions/0148-the-channel-rule.md):
-- one of the channel codes in src/policy/channels.ts. NULL for a lead from the site, whose tags tell.
ALTER TABLE leads ADD COLUMN found_us TEXT;
