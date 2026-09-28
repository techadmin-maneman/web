-- Migration number: 0051
-- Every policy in the console (docs/decisions/0088-every-policy-in-the-console.md).
--
-- ops_settings keeps one row per input ops set, as the record of who set what and when. What a request reads is
-- one row beside it holding every input's value, so the register can grow without each request reading a row per
-- input (ADR 0061's read budget capped it at ten inputs for that reason). Only a table and triggers are added: the
-- Worker already deployed reads and writes ops_settings as before, and its writes keep the new row up to date.

CREATE TABLE ops_settings_snapshot (
  -- There is only ever the one row.
  id INTEGER PRIMARY KEY CHECK (id = 1),
  -- A JSON object: each ops_settings name, with its value as that row holds it. The register decides at read time
  -- whether each still stands, exactly as it does for the rows themselves.
  inputs TEXT NOT NULL CHECK (json_valid(inputs))
);

-- The snapshot is rewritten from ops_settings by ops_settings itself, in the same transaction as every change, so no
-- write -- the console's, a script's or one made by hand -- can leave the two apart.
CREATE TRIGGER ops_settings_snapshot_on_insert AFTER INSERT ON ops_settings
BEGIN
  INSERT OR REPLACE INTO ops_settings_snapshot (id, inputs)
  SELECT 1, json_group_object(name, json(value)) FROM ops_settings;
END;

CREATE TRIGGER ops_settings_snapshot_on_update AFTER UPDATE ON ops_settings
BEGIN
  INSERT OR REPLACE INTO ops_settings_snapshot (id, inputs)
  SELECT 1, json_group_object(name, json(value)) FROM ops_settings;
END;

CREATE TRIGGER ops_settings_snapshot_on_delete AFTER DELETE ON ops_settings
BEGIN
  INSERT OR REPLACE INTO ops_settings_snapshot (id, inputs)
  SELECT 1, json_group_object(name, json(value)) FROM ops_settings;
END;

-- What ops have set so far, so the first read finds it.
INSERT INTO ops_settings_snapshot (id, inputs)
SELECT 1, json_group_object(name, json(value)) FROM ops_settings;

-- The grace a hold was made with, in seconds: how long after its countdown a payment Razorpay made still counts as in
-- time, and how long an unpaid hold keeps its time (docs/decisions/0068-a-paid-hold-is-kept.md). Ops set it in the
-- console now; a hold keeps the one it was made with. Null for a hold made before, which had the committed two
-- minutes (PAYMENT_GRACE_SECONDS, src/config/scheduling.ts).
ALTER TABLE slot_holds ADD COLUMN grace_seconds INTEGER;
