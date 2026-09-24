-- Migration number: 0030
-- When a visit's invoice was issued: marked sent in Books (ADR 0056).
--
-- A draft can be edited, renumbered or deleted, so it is not a valid tax
-- invoice and the client is not shown it. fsm_invoice_id says which invoice a
-- visit has; this column says whether it is one the client may see. They are
-- separate because the invoice must be kept the moment FSM raises it, while
-- Books can refuse to send it. One new column, so deployed code is unaffected.

ALTER TABLE appointments ADD COLUMN invoice_issued_at TEXT;
