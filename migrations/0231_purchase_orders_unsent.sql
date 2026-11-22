-- The purchase orders not yet sent to their supplier, drafted or approved: what the Tasks board's "Custom order to
-- send" reads, never every order ever sent (docs/decisions/0174-custom-orders.md, ADR 0009's reads).
-- backfill: none. An index only.

CREATE INDEX purchase_orders_unsent ON purchase_orders (drafted_at) WHERE state IN ('drafted', 'approved');
