-- Migration number: 0215
-- A client's ask for a hair system made to order (docs/decisions/0253-replacement-when-due-and-change-of-hair-system.md,
-- decision 6): a task on the board until ops close it, having ordered it and booked the fitting, or until a visit of its
-- kind is booked for the client. A new table, and a trigger that updates only it: the Worker already deployed reads and
-- writes none of it.

CREATE TABLE made_to_order_asks (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  -- The visit it was asked at, and the package whose hair system is made to order.
  kind TEXT NOT NULL CHECK (kind IN ('first_fit', 'replacement')),
  tier TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  settled_at TEXT
);

-- One ask open a client and package at a time, however often the step is opened; the Tasks queue reads only these.
CREATE UNIQUE INDEX made_to_order_asks_open ON made_to_order_asks (person_id, kind, tier) WHERE settled_at IS NULL;
-- A client's own asks, for their data's copy and erasure.
CREATE INDEX made_to_order_asks_by_person ON made_to_order_asks (person_id);

-- A visit of the ask's kind booked for the client, by ops or by the client, settles their open asks of that kind: the
-- fitting ops booked once it was ordered, or a hair system in stock the client chose instead.
CREATE TRIGGER made_to_order_asks_settled AFTER INSERT ON appointments
WHEN NEW.type IN ('first_fit', 'replacement')
BEGIN
  UPDATE made_to_order_asks SET settled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE person_id = NEW.person_id AND kind = NEW.type AND settled_at IS NULL;
END;

-- backfill: none. No ask was kept before this migration.
