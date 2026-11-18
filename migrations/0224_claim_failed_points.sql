-- Migration number: 0224
-- The checks a hair system's pieces failed on arrival, named on the receipt and carried by its claim on the supplier
-- (docs/decisions/0169-supplier-claims.md). A new column: the Worker already deployed reads and writes none of it.

-- A JSON array of the points failed (src/policy/receipt-checks.ts); null for any other claim, or one made before.
ALTER TABLE supplier_claims ADD COLUMN failed_points TEXT;

-- backfill: none. A claim made before this migration named no point, and reads as one that names none.
