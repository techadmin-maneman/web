-- Migration number: 0010
-- The access tokens of the Zoho clients other than the CRM's, which keeps its
-- own one-row zoho_token (0002). FSM and Books share one client
-- (docs/decisions/0032-fsm-mirror.md). An access token lasts an hour, and
-- Zoho mints at most 10 per 10 minutes per refresh token, so every invocation
-- shares the cached one. Only a new table, so the code already deployed is
-- unaffected.

CREATE TABLE zoho_tokens (
  client TEXT PRIMARY KEY CHECK (client IN ('fsm')),
  access_token TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
