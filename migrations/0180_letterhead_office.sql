-- A company's registered office and its CIN, which a printed purchase order carries beside its legal name, as the
-- Companies Act 2013 asks of a company's business letters (s.12(3)(c); docs/decisions/0166-purchase-orders.md). Null
-- until ops set them.
ALTER TABLE po_letterhead ADD COLUMN registered_office TEXT;
ALTER TABLE po_letterhead ADD COLUMN cin TEXT;
