-- Migration number: 0058
-- A booking FSM refuses is held, not refunded (docs/decisions/0095-a-booking-fsm-refuses-is-held.md). Two columns
-- are added, both empty on every hold there is. The Worker already deployed reads neither and writes neither: it
-- still gives a refused booking up and refunds it, which leaves them empty, and a hold it gives up is released, which
-- nothing here reads as held.

-- When FSM's fifth refusal running held the booking for ops, rather than giving it up. The hourly tries count their
-- 24 hours from it, and the Tasks board lists the booking from it until it is booked or refunded. Kept once the
-- booking is booked or refunded, as the record that it waited.
ALTER TABLE slot_holds ADD COLUMN fsm_held_at TEXT;

-- FSM's latest refusal, as the log gives it (failureReason, src/log.ts), for ops to read beside the booking.
ALTER TABLE slot_holds ADD COLUMN fsm_refusal TEXT;
