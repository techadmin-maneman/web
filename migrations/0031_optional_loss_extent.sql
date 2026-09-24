-- Migration number: 0031
-- contract: docs/decisions/0060-an-invited-friend-reaches-ops-and-the-crm.md
--
-- Makes leads.loss_extent optional, so that a booking from the referral landing
-- leaves a lead. Only the site's own form asks where the hair loss is; an invited
-- friend is never asked, and the NOT NULL stopped their lead being written at all.
--
-- Migration 0025 tried this by rebuilding the table and was withdrawn: tryon_jobs
-- points at a lead, D1 runs a migration in one transaction, and dropping the
-- parent is a violation that re-creating it does not undo. Nothing is rebuilt
-- here. The column is swapped in place, so `leads` is never dropped and the
-- reference into it is never disturbed.
--
-- The swap is one transaction, and the column keeps its name and its three
-- answers, so the running Worker writes what it wrote before and reads what it
-- read before.

ALTER TABLE leads ADD COLUMN loss_extent_next TEXT CHECK (
  loss_extent_next IN ('crown', 'receding', 'advanced')
);

UPDATE leads SET loss_extent_next = loss_extent;

ALTER TABLE leads DROP COLUMN loss_extent;

ALTER TABLE leads RENAME COLUMN loss_extent_next TO loss_extent;
