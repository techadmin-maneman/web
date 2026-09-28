-- Migration number: 0053
-- What each place holds of each consumable, and each client's last visits,
-- kept as the rows behind them are written, so the Stock page, the low-stock
-- check and the Tasks board read what they show rather than every movement and
-- every visit ever made (ADR 0009: past 5 million rows read a day D1 refuses
-- every query until midnight UTC). docs/decisions/0087-consumables-and-stock.md
-- and 0086-the-next-visit-is-offered.md; the plan's piece C27.
--
-- Triggers keep both, so each is moved in the same statement as the row behind
-- it, by whatever code writes that row: the Worker already deployed, which
-- reads neither, keeps them true until this release reaches it. Only new
-- tables, a view, triggers and indexes, each filled from what is there.
--
-- It was 0052 until staging refused it: wrangler splits a migration into
-- statements before D1 runs it, and takes a CASE's END inside a trigger for
-- the trigger's own, so everything after it went as one statement. A trigger
-- here uses iif() instead, and test/node/migration-statements.test.ts splits
-- every migration as wrangler does.

-- What each place holds of each consumable: the sum of its rows in
-- stock_movements, which stays the record of how it came to hold it.
CREATE TABLE stock_balances (
  consumable_code TEXT NOT NULL REFERENCES consumables (code),
  -- 'central' for the central store; for a technician's kit, his ID.
  place TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  -- When the place last counted it; NULL if never.
  counted_at TEXT,
  PRIMARY KEY (consumable_code, place)
);

INSERT INTO stock_balances (consumable_code, place, quantity, counted_at)
SELECT consumable_code, COALESCE(technician_id, 'central'), SUM(quantity),
       MAX(CASE WHEN reason = 'counted' THEN created_at END)
  FROM stock_movements
 GROUP BY consumable_code, technician_id;

-- Each row written moves its place's balance, and a count says when the place
-- counted: the later of it and the count already kept, as the backfill takes
-- the latest, so a count that lands after a later one leaves the later.
CREATE TRIGGER stock_movements_balance AFTER INSERT ON stock_movements
BEGIN
  INSERT INTO stock_balances (consumable_code, place, quantity, counted_at)
  VALUES (NEW.consumable_code, COALESCE(NEW.technician_id, 'central'), NEW.quantity,
          iif(NEW.reason = 'counted', NEW.created_at, NULL))
  ON CONFLICT (consumable_code, place) DO UPDATE SET
    quantity = stock_balances.quantity + excluded.quantity,
    counted_at = iif(stock_balances.counted_at IS NULL OR excluded.counted_at > stock_balances.counted_at,
                     excluded.counted_at, stock_balances.counted_at);
END;

-- A movement is never changed. The staging fixtures take their own rows out
-- again (e2e/tech-staging/seed.ts, scripts/seed-technician-tester.ts), and each
-- place then holds what it held before them.
CREATE TRIGGER stock_movements_no_update BEFORE UPDATE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'stock_movements is append-only');
END;

CREATE TRIGGER stock_movements_taken_out AFTER DELETE ON stock_movements
BEGIN
  UPDATE stock_balances
     SET quantity = quantity - OLD.quantity,
         counted_at = (SELECT MAX(m.created_at) FROM stock_movements m
                        WHERE m.technician_id IS OLD.technician_id AND m.consumable_code = OLD.consumable_code
                          AND m.reason = 'counted')
   WHERE consumable_code = OLD.consumable_code AND place = COALESCE(OLD.technician_id, 'central');
END;

-- The Stock page's latest movements, newest first, read without the ones before them.
CREATE INDEX stock_movements_latest ON stock_movements (created_at);

-- Each client's last visits done, worked out from their appointments: the last
-- first fit, service or replacement, which the next service follows and the
-- Tasks board's At-risk client counts from, and the last consultation, which a
-- first fit asked for on the site's form follows. All three are NULL for a
-- client with neither.
CREATE VIEW last_visits_now AS
SELECT p.id AS person_id,
       (SELECT a.id FROM appointments a
         WHERE a.person_id = p.id AND a.status = 'completed' AND a.deleted_at IS NULL
           AND a.type IN ('first_fit', 'service', 'replacement') AND a.window_start IS NOT NULL
         ORDER BY a.window_start DESC LIMIT 1) AS visit_id,
       (SELECT MAX(a.window_start) FROM appointments a
         WHERE a.person_id = p.id AND a.status = 'completed' AND a.deleted_at IS NULL
           AND a.type IN ('first_fit', 'service', 'replacement')) AS visit_start,
       (SELECT MAX(a.window_start) FROM appointments a
         WHERE a.person_id = p.id AND a.status = 'completed' AND a.deleted_at IS NULL
           AND a.type = 'consultation') AS consulted_start
  FROM people p;

-- The same, kept for each client whose visits have ever included one done,
-- which the Tasks board reads.
CREATE TABLE last_visits (
  person_id TEXT PRIMARY KEY,
  visit_id TEXT,
  visit_start TEXT,
  consulted_start TEXT
);

-- The At-risk clients: those whose last visit is long enough ago.
CREATE INDEX last_visits_by_visit_start ON last_visits (visit_start);

INSERT INTO last_visits (person_id, visit_id, visit_start, consulted_start)
SELECT person_id, visit_id, visit_start, consulted_start
  FROM last_visits_now
 WHERE visit_start IS NOT NULL OR consulted_start IS NOT NULL;

-- A client's row is worked out afresh as one of their visits done is added,
-- taken away, or changes client, kind, start, status or deletion. Nothing
-- else about an appointment moves it, so the mirror writing a visit again as
-- it was writes nothing here.
CREATE TRIGGER appointments_last_visits_added AFTER INSERT ON appointments
WHEN NEW.status = 'completed'
BEGIN
  INSERT INTO last_visits (person_id, visit_id, visit_start, consulted_start)
  SELECT person_id, visit_id, visit_start, consulted_start FROM last_visits_now WHERE person_id = NEW.person_id
  ON CONFLICT (person_id) DO UPDATE SET
    visit_id = excluded.visit_id, visit_start = excluded.visit_start, consulted_start = excluded.consulted_start;
END;

CREATE TRIGGER appointments_last_visits_changed
AFTER UPDATE OF person_id, type, window_start, status, deleted_at ON appointments
WHEN (OLD.status = 'completed' OR NEW.status = 'completed')
  AND (OLD.person_id IS NOT NEW.person_id OR OLD.type IS NOT NEW.type OR OLD.window_start IS NOT NEW.window_start
    OR OLD.status IS NOT NEW.status OR OLD.deleted_at IS NOT NEW.deleted_at)
BEGIN
  INSERT INTO last_visits (person_id, visit_id, visit_start, consulted_start)
  SELECT person_id, visit_id, visit_start, consulted_start FROM last_visits_now
   WHERE person_id IN (OLD.person_id, NEW.person_id)
  ON CONFLICT (person_id) DO UPDATE SET
    visit_id = excluded.visit_id, visit_start = excluded.visit_start, consulted_start = excluded.consulted_start;
END;

CREATE TRIGGER appointments_last_visits_taken_out AFTER DELETE ON appointments
WHEN OLD.status = 'completed'
BEGIN
  INSERT INTO last_visits (person_id, visit_id, visit_start, consulted_start)
  SELECT person_id, visit_id, visit_start, consulted_start FROM last_visits_now WHERE person_id = OLD.person_id
  ON CONFLICT (person_id) DO UPDATE SET
    visit_id = excluded.visit_id, visit_start = excluded.visit_start, consulted_start = excluded.consulted_start;
END;

-- What the Tasks board looks for before it lists a client, each found without
-- reading the visits and bookings the client has had: a visit still to happen,
-- and a booking paid for, or free, that FSM has not yet taken.
CREATE INDEX appointments_live_by_person ON appointments (person_id)
  WHERE status IN ('scheduled', 'dispatched', 'in_progress') AND deleted_at IS NULL;
CREATE INDEX slot_holds_confirmed_by_person ON slot_holds (person_id) WHERE state = 'held' AND confirmed_at IS NOT NULL;
