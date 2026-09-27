-- Migration number: 0050
-- Services ops can edit (docs/decisions/0085-services-ops-can-edit.md). Every service is one of the four kinds of
-- visit, and a tier of it: the price book already keys its prices by the two (price_book.item and .tier), so its
-- rows stay as they are, and a hold, a payment and an invoice keep the price they were sold at. Ops add, rename,
-- time, order and retire services in the console; a new kind needs a release.
--
-- Only a table and columns are added. The Worker already deployed reads none of them, and every hold it makes is
-- the standard tier's, which is all it books, so the default on slot_holds.tier is what its holds are.

CREATE TABLE services (
  -- The kind of visit, which decides the technician's steps, the booking rules and the fees.
  kind TEXT NOT NULL CHECK (kind IN ('consultation', 'first_fit', 'service', 'replacement')),
  -- The code the price book prices it under: small letters, digits and _, a letter first (PRICE_TIER,
  -- src/config/ops-settings.ts). Made from its first name, and never changed after, so its prices stay its own.
  tier TEXT NOT NULL CHECK (
    length(tier) BETWEEN 1 AND 32 AND tier GLOB '[a-z]*' AND tier NOT GLOB '*[^a-z0-9_]*'
  ),
  -- What clients, ops and FSM's catalogue call it. One name, one service, so FSM's item can be found by it.
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  -- How long FSM books it for, which is the time the scheduler reserves (src/policy/visit-length.ts).
  minutes INTEGER NOT NULL CHECK (minutes BETWEEN 30 AND 480),
  -- Its place among its kind's services, as the console and the app list them.
  sort INTEGER NOT NULL DEFAULT 0,
  -- India's date from which clients no longer see it or book it; null while it is offered.
  retired_date TEXT,
  -- Its service item in FSM's catalogue, once found or made; until then it is looked for by name.
  fsm_item_id TEXT,
  -- The Access identity that last changed it, and when; the audit log holds each change.
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, tier)
);

-- The four services there have been all along: each kind's standard tier, named as FSM names its item
-- (FSM_SERVICE_NAMES, src/config/visit-types.ts), and as long as the owner ruled on 24 September 2026
-- (VISIT_BLOCKS, src/config/scheduling.ts). Their items are found by name at the first booking or check.
INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at) VALUES
  ('consultation', 'standard', 'Consultation', 60, 0, 'migrations/0050_services.sql', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('first_fit', 'standard', 'First fit', 180, 0, 'migrations/0050_services.sql', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('service', 'standard', 'Service visit', 90, 0, 'migrations/0050_services.sql', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('replacement', 'standard', 'Replacement', 135, 0, 'migrations/0050_services.sql', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- The service a hold is for, beside its kind (type): its price, late fee and length are copied onto it as it is
-- made, so what the client was sold stays sold whatever ops change after.
ALTER TABLE slot_holds ADD COLUMN tier TEXT NOT NULL DEFAULT 'standard';

-- How long the hold's visit was held for, in minutes: the service's length when it was made. Null for a hold made
-- before services had lengths of their own, which took its kind's (VISIT_BLOCKS).
ALTER TABLE slot_holds ADD COLUMN minutes INTEGER;

-- The service an appointment is, beside its kind (type): from the hold that booked it, or from its FSM item. Null
-- where neither says, as for every appointment mirrored before this; it is then read as the standard tier.
ALTER TABLE appointments ADD COLUMN tier TEXT;
