-- Migration number: 0015
-- A booked lead becomes a Request in FSM, for ops to schedule there
-- (docs/decisions/0032-fsm-mirror.md, "Leads into FSM"). The Request's ID
-- marks the lead as sent, so it is sent once. Only a new column, so the code
-- already deployed is unaffected.

ALTER TABLE leads ADD COLUMN fsm_request_id TEXT;
