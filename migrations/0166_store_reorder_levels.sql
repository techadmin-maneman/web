-- Migration number: 0166
-- A consumable's low-stock level in a city stockroom or a hub, apart from the warehouse's, so a store is judged by
-- what a store holds (src/domain/field/low-stock.ts). Null tells nothing of a store until ops set one.
--
-- A new nullable column: the Worker already deployed reads none of it, and judges stores by the central level.

ALTER TABLE consumables ADD COLUMN reorder_store INTEGER CHECK (reorder_store >= 0);
