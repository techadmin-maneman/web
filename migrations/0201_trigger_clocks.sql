-- The triggers that stamp a time stamp the row's own, which the Worker writes from its clock, not SQLite's: a
-- technician's kit is made when the technician is added, and a client is a client from their first payment. The
-- audit log's two-year guard keeps SQLite's clock on purpose: a deletion of the log is judged by the real date.
DROP TRIGGER IF EXISTS people_client_by_payment;
CREATE TRIGGER people_client_by_payment AFTER INSERT ON payments
WHEN NEW.person_id IS NOT NULL
BEGIN
  UPDATE people SET client_since = COALESCE(NEW.created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
   WHERE id = NEW.person_id AND client_since IS NULL;
END;

DROP TRIGGER IF EXISTS people_client_by_payment_given;
CREATE TRIGGER people_client_by_payment_given AFTER UPDATE OF person_id ON payments
WHEN NEW.person_id IS NOT NULL
BEGIN
  UPDATE people SET client_since = COALESCE(NEW.created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
   WHERE id = NEW.person_id AND client_since IS NULL;
END;

DROP TRIGGER IF EXISTS technicians_kit;
CREATE TRIGGER technicians_kit AFTER INSERT ON technicians
BEGIN
  INSERT OR IGNORE INTO stock_places (id, kind, parent_id, technician_id, created_by, created_at)
  VALUES (NEW.id, 'kit', 'central', NEW.id, 'technicians', COALESCE(NEW.updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
END;
