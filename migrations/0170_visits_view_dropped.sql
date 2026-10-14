-- Migration number: 0170
-- The view `visits` served the Worker that read the outcome table by its old name; none does now.
-- contract: docs/decisions/0199-derived-state-in-the-domain.md

DROP VIEW visits;
