-- A receipt takes no more of a line than was ordered, and a supplier's invoice once
-- (src/domain/field/receipts.ts checks both first and names the field; these hold when two receipts land at once).

CREATE TRIGGER po_lines_not_over_received BEFORE UPDATE OF received_quantity ON po_lines
WHEN NEW.received_quantity > NEW.quantity
BEGIN
  SELECT RAISE(ABORT, 'over_received');
END;

CREATE TRIGGER receipts_invoice_once BEFORE INSERT ON receipts
WHEN NEW.supplier_invoice IS NOT NULL AND EXISTS (
  SELECT 1 FROM receipts r JOIN purchase_orders o ON o.id = r.po_id
  WHERE o.supplier_id = (SELECT supplier_id FROM purchase_orders WHERE id = NEW.po_id)
    AND lower(trim(r.supplier_invoice)) = lower(trim(NEW.supplier_invoice))
)
BEGIN
  SELECT RAISE(ABORT, 'invoice_received');
END;
