-- What a printed purchase order says of us, which ops set once on the Purchasing page: the legal name, the GSTIN, and
-- where the supplier delivers (docs/decisions/0166-purchase-orders.md). No row until ops set it.
CREATE TABLE po_letterhead (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  legal_name TEXT NOT NULL,
  gstin TEXT,
  deliver_to TEXT NOT NULL,
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL
);
