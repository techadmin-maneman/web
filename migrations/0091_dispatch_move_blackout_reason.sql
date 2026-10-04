-- Migration number: 0091
-- Why ops moved a visit onto a day they blacked out, as they typed it; null for a move onto any other day. Blanked
-- when the client is erased. A nullable column only, so the Worker already deployed is unaffected.

ALTER TABLE dispatch_moves ADD COLUMN blackout_reason TEXT;
