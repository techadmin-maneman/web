-- A receipt takes no more of a line than was ordered (src/domain/field/receipts.ts checks first and names the field;
-- this holds when two receipts land at once). A supplier's invoice taken twice is refused by the route alone: the
-- Worker already deployed receives a second delivery under the same invoice, which a trigger would fail.

CREATE TRIGGER po_lines_not_over_received BEFORE UPDATE OF received_quantity ON po_lines
WHEN NEW.received_quantity > NEW.quantity
BEGIN
  SELECT RAISE(ABORT, 'over_received');
END;
