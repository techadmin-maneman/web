-- Migration number: 0077
-- Ops cancelling a visit from the console, and closing one by hand whose technician's phone was lost before it sent
-- anything. Only nullable columns are added, null for every change a client made and every visit the field closed, so
-- the Worker already deployed is unaffected.

-- A cancel ops made: the Access e-mail of who made it, their reason as they typed it, and the terms it was made on:
-- free to the client, or the client's own late terms.
ALTER TABLE visit_changes ADD COLUMN cancelled_by TEXT;
ALTER TABLE visit_changes ADD COLUMN cancel_reason TEXT;
ALTER TABLE visit_changes ADD COLUMN ops_terms TEXT CHECK (ops_terms IN ('free', 'client'));

-- A visit ops closed by hand: who closed it, and why, as they typed it.
ALTER TABLE visits ADD COLUMN closed_by TEXT;
ALTER TABLE visits ADD COLUMN close_reason TEXT;
