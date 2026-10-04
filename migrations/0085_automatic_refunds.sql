-- Migration number: 0085
-- Why a booking refunded its hold by itself, which the client's Visits tab in the console says: 'lapsed', paid after
-- the hold and its grace had run out; 'not_movable', a move whose visit the technician had already begun. Null for a
-- hold never refunded, and for one ops refunded.
--
-- Expand only: a new column, empty. The Worker already deployed neither writes nor reads it.

ALTER TABLE slot_holds ADD COLUMN auto_refund_reason TEXT CHECK (auto_refund_reason IN ('lapsed', 'not_movable'));
