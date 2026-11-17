-- Migration number: 0215
-- A hair system made to order (docs/decisions/0253-replacement-when-due-and-change-of-hair-system.md, decision 6): a
-- client whose size no stock code matches is told so as they book a first fit or a replacement, and their ask is kept
-- here, a task on the board until ops close it, having ordered it, taken payment and booked the fitting on WhatsApp.
-- A new table: the Worker already deployed reads and writes none of it.

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

-- backfill: none. No ask was kept before this migration.
