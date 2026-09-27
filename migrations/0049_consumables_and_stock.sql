-- Migration number: 0049
-- Consumables and their stock, and the job sheet ops set in the console
-- (docs/decisions/0087-consumables-and-stock.md; the owner's answers of 27
-- September 2026, item 28 and "Consumables, stock and FSM"). Only new tables
-- and new nullable columns, so the Worker already deployed is unaffected.

-- What a technician uses on a job: a strip of tape, a millilitre of solvent, a
-- sachet. Ops add, rename, cost and retire each in the console, and the
-- technician app offers every one not retired. What one costs is ours alone:
-- a job's use is kept here and on FSM's summary, and never written as a line
-- of the work order, so no client's invoice carries it.
CREATE TABLE consumables (
  -- What the technician app sends and the ledger keys on. Made from the name
  -- when the consumable is added and never changed, so a rename keeps its
  -- history and a phone that queued it offline is still understood.
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- What one is counted in: strip, ml, sachet.
  unit TEXT NOT NULL,
  -- In paise, for one unit.
  unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0),
  -- A kit, or the central store, is low at or below its level; NULL for no level.
  reorder_kit INTEGER CHECK (reorder_kit >= 0),
  reorder_central INTEGER CHECK (reorder_central >= 0),
  -- The day in India from which it is no longer offered; NULL while it is.
  retired_date TEXT,
  -- FSM's Part for it, once the hourly check finds one by its name or the push
  -- makes one; the name FSM gives that Part; and when the check first found
  -- FSM so. All three stay empty until the check has run.
  fsm_item_id TEXT,
  fsm_name TEXT,
  fsm_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- No two are called the same, whatever the case, so a name matched against
-- FSM's catalogue, or typed by a phone that knew no codes, names one.
CREATE UNIQUE INDEX consumables_name ON consumables (name COLLATE NOCASE);

-- What each service is expected to use: the technician's steppers start here.
-- A service is a kind of visit at one of the price book's tiers, checked in
-- code against the pairs the book holds. It is tied to the table of services
-- (ADR 0025, item 67) once that exists; until then it names the pair, with no
-- foreign key.
CREATE TABLE consumable_usage (
  visit_type TEXT NOT NULL CHECK (visit_type IN ('consultation', 'first_fit', 'service', 'replacement')),
  tier TEXT NOT NULL DEFAULT 'standard',
  consumable_code TEXT NOT NULL REFERENCES consumables (code),
  -- How many of its unit, a whole number.
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL,
  PRIMARY KEY (visit_type, tier, consumable_code)
);

-- Stock, which is ours: FSM keeps none without Zoho Inventory. Every movement
-- into or out of the central store or a technician's kit is a row, never
-- changed, and what a place holds is the sum of its rows. A delivery is
-- received into the central store; a transfer is two rows, out of one place
-- and into another; a job's use comes out of the kit of the technician who
-- did it; a count writes the difference from what the rows said; a write-off
-- is a loss somebody saw.
CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  consumable_code TEXT NOT NULL REFERENCES consumables (code),
  location TEXT NOT NULL CHECK (location IN ('central', 'kit')),
  -- Whose kit; NULL for the central store.
  technician_id TEXT REFERENCES technicians (id),
  -- Into the place, positive; out of it, negative. Only a count that matched is nought.
  quantity INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('received', 'transferred', 'used', 'counted', 'written_off')),
  -- The two rows of one transfer share it.
  transfer_id TEXT,
  -- A job's use: the visit, and the technician's event that recorded it.
  appointment_id TEXT REFERENCES appointments (id),
  job_event_id TEXT REFERENCES job_events (id),
  -- Who: a member of staff by their Access identity, or the technician by our ID.
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('staff', 'service', 'technician')),
  actor TEXT NOT NULL,
  -- Ops' own words: the supplier's note, what was lost. Never a client's name.
  note TEXT,
  created_at TEXT NOT NULL,
  CHECK ((location = 'central') = (technician_id IS NULL)),
  CHECK (quantity <> 0 OR reason = 'counted'),
  CHECK ((reason = 'transferred') = (transfer_id IS NOT NULL)),
  CHECK ((reason = 'used') = (job_event_id IS NOT NULL)),
  CHECK (reason <> 'used' OR (location = 'kit' AND appointment_id IS NOT NULL))
);

-- What a place holds, a consumable at a time: the central store is the NULL technician.
CREATE INDEX stock_movements_held ON stock_movements (technician_id, consumable_code);

-- A job's use is written once however often its event is replayed, and a
-- later event of the same job writes only what differs from what is written.
CREATE UNIQUE INDEX stock_movements_used ON stock_movements (job_event_id, consumable_code) WHERE reason = 'used';
CREATE INDEX stock_movements_by_job ON stock_movements (appointment_id) WHERE reason = 'used';

-- A job's use as the technician recorded it, now that the step names each
-- consumable by its code: which one, what the job's service expected of it,
-- and what one cost that day. An item a phone queued by name before this
-- release keeps its name alone, and all three stay empty.
ALTER TABLE consumables_used ADD COLUMN consumable_code TEXT REFERENCES consumables (code);
ALTER TABLE consumables_used ADD COLUMN expected_quantity INTEGER;
ALTER TABLE consumables_used ADD COLUMN unit_cost INTEGER;

-- One row for each consumable an event recorded, whatever the consumable is
-- called when the event is read again: a step replayed after ops renamed it
-- would otherwise write a second row under the new name.
CREATE UNIQUE INDEX consumables_used_by_event_and_code ON consumables_used (job_event_id, consumable_code)
  WHERE consumable_code IS NOT NULL;

-- The job sheet ops set in the console (docs/open-points.md, item 28): each
-- kind of visit's checklist, and the reasons a job may be left partly done,
-- which the technician app reads with the job. A kind with no rows takes the
-- committed list in src/config/job-sheet.ts, and so do the reasons; once ops
-- save a list, its rows are the list. An item ops take off is retired, not
-- deleted, so a phone that queued it offline is still understood and a job's
-- summary can still name it.
CREATE TABLE checklist_items (
  visit_type TEXT NOT NULL CHECK (visit_type IN ('consultation', 'first_fit', 'service', 'replacement')),
  -- What the app sends back; made from the label when the item is added.
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  -- The order the technician sees them in.
  position INTEGER NOT NULL,
  retired_at TEXT,
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL,
  PRIMARY KEY (visit_type, code)
);

CREATE TABLE partial_reasons (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  retired_at TEXT,
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL
);
