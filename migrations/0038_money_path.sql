-- Migration number: 0038
-- The money path (docs/decisions/0067-a-paid-hold-is-kept.md): a hold the
-- client has paid for is kept until it is booked or refunded, FSM is written
-- once however often a booking is tried, and a payment keeps the GST it was
-- sold at. Only new columns and indexes, so the code already deployed is
-- unaffected.

-- When the client's side of a hold was done: Razorpay's own time for its
-- payment, or when a free visit was booked. From then the hold keeps its time
-- until it is booked or refunded, however long FSM takes, and nothing else lets
-- it go.
ALTER TABLE slot_holds ADD COLUMN confirmed_at TEXT;
-- When the booking was put on the fsm-sync queue, or was due to be. The cron
-- puts back one still neither booked nor refunded 30 minutes later.
ALTER TABLE slot_holds ADD COLUMN queued_at TEXT;
-- The lease one consumer holds while it writes the hold to FSM, so two never write it at once.
ALTER TABLE slot_holds ADD COLUMN booking_until TEXT;
-- Set before the work order is first asked for, so a later try knows FSM may
-- have made one whose answer never reached us, and looks for it first.
ALTER TABLE slot_holds ADD COLUMN fsm_tried_at TEXT;
-- FSM's IDs, each kept the moment FSM answers with it, so a retry reuses them.
ALTER TABLE slot_holds ADD COLUMN fsm_work_order_id TEXT;
ALTER TABLE slot_holds ADD COLUMN fsm_appointment_id TEXT;
-- Where the visit is: the pincode it was booked at, for the visit and FSM.
ALTER TABLE slot_holds ADD COLUMN pincode TEXT;
-- A first fit's or a replacement's late fee when it was held, in paise before
-- GST, and its rate: what moving or cancelling it late costs, whatever the
-- price book says later.
ALTER TABLE slot_holds ADD COLUMN late_fee_ex_gst INTEGER;
ALTER TABLE slot_holds ADD COLUMN late_fee_gst_percent INTEGER;

-- The cron's pass over holds confirmed and not yet booked.
CREATE INDEX slot_holds_confirmed ON slot_holds (queued_at) WHERE state = 'held' AND confirmed_at IS NOT NULL;
-- A visit's terms read the late fee from the hold that booked it.
CREATE INDEX slot_holds_by_appointment ON slot_holds (appointment_id) WHERE appointment_id IS NOT NULL;

-- What a payment was before GST, and at what rate, as the hold priced it. Null
-- for a payment no hold priced, which the Payments tab splits at GST_PERCENT.
ALTER TABLE payments ADD COLUMN amount_ex_gst INTEGER;
ALTER TABLE payments ADD COLUMN gst_percent INTEGER;

-- Set before a lead's Request is first asked of FSM, as for a work order above.
ALTER TABLE leads ADD COLUMN fsm_request_tried_at TEXT;
