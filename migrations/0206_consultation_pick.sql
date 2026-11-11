-- Migration number: 0206
-- The hair system a consultation's client picked from Options, going ahead with a fit, by its tier
-- (docs/decisions/0247-the-steps-left.md). Ops read it on the client's First fit to book task. Only a new column, which
-- the code deployed neither reads nor writes.
ALTER TABLE visit_outcomes ADD COLUMN picked_tier TEXT;
