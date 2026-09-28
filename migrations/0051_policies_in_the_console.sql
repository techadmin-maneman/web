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

-- What a waiver gave back, kept on the ruling: whether the visit's payment was refunded or kept, and its credit
-- returned or spent. Ops set what a waiver gives in the console now, so the client's message and the money follow
-- what was ruled, whatever is set after. Null for a charge, and for a waiver ruled before, which gave both back
-- (WAIVER_GIVES_BACK, src/policy/no-show.ts).
ALTER TABLE no_show_cases ADD COLUMN waiver_payment TEXT;
ALTER TABLE no_show_cases ADD COLUMN waiver_credit TEXT;

-- The terms a hold was sold under, so a change in the console never moves a promise already made: how many hours
-- before its window moving or cancelling it stops being free, and what its kind costs inside that notice, and what it
-- costs if the client is not home. Each charge is one of src/policy/moving-a-visit.ts's Charge ('nothing',
-- 'late_fee', 'visit'); there is no CHECK, since slot_holds is referenced by other tables and could not be rebuilt
-- to change one. Null for a hold made before, which was sold under the committed terms (FREE_CHANGE_NOTICE_HOURS,
-- LATE_CHANGE_CHARGES, NO_SHOW_CHARGES).
ALTER TABLE slot_holds ADD COLUMN change_notice_hours INTEGER;
ALTER TABLE slot_holds ADD COLUMN late_change_charge TEXT;
ALTER TABLE slot_holds ADD COLUMN no_show_charge TEXT;

-- Blackout days are set in the console now, where the runbook's SQL set them: who set each and when, as every ops
-- change records it (ADR 0031). Null for a day the runbook's SQL wrote before.
ALTER TABLE visit_blackouts ADD COLUMN set_by TEXT;
ALTER TABLE visit_blackouts ADD COLUMN set_at TEXT;
