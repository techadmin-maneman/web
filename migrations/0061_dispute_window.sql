-- Migration number: 0061
-- How long a client may dispute a no-show's charge: 30 days after it, the
-- owner ruled on 30 September 2026, a figure ops may change in the console
-- (docs/open-points.md, item 60; ADR 0025, item 85). Each charge keeps the
-- deadline it was given, as a booking keeps the terms it was sold under
-- (docs/decisions/0088-every-policy-in-the-console.md), so a change reaches new
-- charges only. A charge made before this has 30 days from its ruling.
--
-- Expand only: the Worker already deployed reads nothing of it.

ALTER TABLE no_show_cases ADD COLUMN dispute_until TEXT;

UPDATE no_show_cases SET dispute_until = strftime('%Y-%m-%dT%H:%M:%fZ', decided_at, '+30 days')
 WHERE decision = 'charged' AND decided_at IS NOT NULL;
