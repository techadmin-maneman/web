-- Migration number: 0041
-- Vendor correctness (docs/decisions/0070-vendor-correctness.md). Only new
-- columns, a new table and a copy into it, so the code already deployed is
-- unaffected.

-- When FSM last failed to say what a visit's client asked for. The pass asks
-- about it again an hour later, rather than first on every run
-- (src/domain/asked-windows.ts).
ALTER TABLE appointments ADD COLUMN asked_failed_at TEXT;

-- One table for every Zoho client's access token, the CRM's and FSM's (which
-- Books shares), in place of zoho_token (0002) and zoho_tokens (0010). The
-- deployed code keeps using those two until this code replaces it; they are
-- dropped in a later contract step. Beside each token, the lease one caller
-- holds while it asks Zoho for a new one, and the time until which none is
-- asked for after Zoho refused one (src/providers/zoho-http.ts).
CREATE TABLE zoho_access_tokens (
  client TEXT PRIMARY KEY CHECK (client IN ('crm', 'fsm')),
  access_token TEXT,
  expires_at TEXT,
  refreshing_until TEXT,
  cool_down_until TEXT
);
-- The tokens held now, so the first calls after the deploy ask Zoho for none.
INSERT INTO zoho_access_tokens (client, access_token, expires_at)
  SELECT 'crm', access_token, expires_at FROM zoho_token WHERE id = 1;
INSERT INTO zoho_access_tokens (client, access_token, expires_at)
  SELECT 'fsm', access_token, expires_at FROM zoho_tokens WHERE client = 'fsm';
