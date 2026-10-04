-- Migration number: 0089
-- A line ops write for each service, which clients read under its name as they choose: what sets one hair system
-- apart from another. Null until ops write one. The Worker already deployed reads none of it.

ALTER TABLE services ADD COLUMN description TEXT CHECK (description IS NULL OR length(description) BETWEEN 1 AND 160);
