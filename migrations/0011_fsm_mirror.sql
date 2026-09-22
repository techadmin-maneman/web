-- Migration number: 0011
-- The D1 mirror of Zoho FSM (docs/decisions/0032-fsm-mirror.md). FSM is the
-- record: every row here is a copy, rewritten from FSM whenever it changes,
-- and never edited on its own. Also the inbox of FSM's webhooks. Only new
-- tables and a new column, so the code already deployed is unaffected.

-- The FSM contact a person is, once the mirror has matched them by mobile number.
ALTER TABLE people ADD COLUMN fsm_contact_id TEXT;
CREATE UNIQUE INDEX people_by_fsm_contact ON people (fsm_contact_id) WHERE fsm_contact_id IS NOT NULL;

-- FSM's service resources: display name and initials only.
CREATE TABLE technicians (
  id TEXT PRIMARY KEY,
  fsm_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  initials TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  updated_at TEXT NOT NULL
);

-- FSM's catalogue, kept to read each appointment's visit type from its service item.
CREATE TABLE fsm_items (
  fsm_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Service', 'Part')),
  updated_at TEXT NOT NULL
);

CREATE TABLE appointments (
  id TEXT PRIMARY KEY,
  fsm_id TEXT NOT NULL UNIQUE,
  fsm_work_order_id TEXT,
  -- NULL while FSM's client has no mobile number the mirror could match.
  person_id TEXT REFERENCES people (id),
  -- NULL for an appointment for none of our four services.
  type TEXT CHECK (type IN ('consultation', 'first_fit', 'service', 'replacement')),
  window_start TEXT,
  window_end TEXT,
  -- The lead technician.
  technician_id TEXT REFERENCES technicians (id),
  status TEXT NOT NULL CHECK (
    status IN ('scheduled', 'dispatched', 'in_progress', 'completed', 'cancelled', 'terminated', 'other')
  ),
  -- FSM's own word, kept for a status the mirror does not know.
  fsm_status TEXT NOT NULL,
  service_city TEXT,
  service_pincode TEXT,
  fsm_invoice_id TEXT,
  fsm_modified_at TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  -- Set when FSM no longer has the appointment.
  deleted_at TEXT
);

CREATE INDEX appointments_by_person ON appointments (person_id, window_start);
CREATE INDEX appointments_by_technician ON appointments (technician_id, window_start);

-- What an appointment became once FSM closed it.
CREATE TABLE visits (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments (id),
  started_at TEXT,
  ended_at TEXT,
  duration_minutes INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN ('done', 'partial')),
  -- From the job sheet once its template exists (docs/open-points.md, item 13).
  partial_reason TEXT,
  updated_at TEXT NOT NULL
);

-- FSM's webhooks, each kept once. FSM sends no event ID, so a delivery is the
-- same event when its module, record and modified time are the same.
CREATE TABLE webhook_inbox (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('fsm')),
  dedupe_key TEXT NOT NULL UNIQUE,
  module TEXT NOT NULL,
  record_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX webhook_inbox_unprocessed ON webhook_inbox (processed_at, received_at);
