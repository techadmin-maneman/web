-- Four tables nothing has read or written since FSM went and the Zoho token moved: FSM's sync cursors and webhook inbox,
-- and the two token tables before zoho_access_tokens.
-- contract: docs/decisions/0113-fsms-columns-go.md
-- contract: docs/decisions/0070-vendor-correctness.md

DROP TABLE sync_cursors;
DROP TABLE webhook_inbox;
DROP TABLE zoho_token;
DROP TABLE zoho_tokens;
