-- Migration number: 0088
--
-- When the chat was last told of an alert, so an alert that stays open is told
-- again on a clock and not only as its count grows. Then the open alerts whose
-- subject is gone are closed. The code already deployed reads none of this.

ALTER TABLE alerts ADD COLUMN last_told_at TEXT;

UPDATE alerts SET last_told_at = told_at WHERE resolved_at IS NULL;

-- Google's refusals and Turnstile's outages were kept one alert a day. Each is one alert now, closed by the next
-- success, so the dated ones close.
UPDATE alerts SET resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE resolved_at IS NULL
  AND substr(key, 1, instr(key, ':') - 1) IN ('google_refused', 'turnstile_unavailable');

-- Invoice alerts of visits FSM deleted.
UPDATE alerts SET resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE resolved_at IS NULL
  AND substr(key, 1, instr(key, ':') - 1) IN ('invoice_draft', 'invoice_unpriced', 'invoice_refused', 'invoice_failed')
  AND EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.id = substr(alerts.key, instr(alerts.key, ':') + 1) AND a.deleted_at IS NOT NULL);

-- A technician's step that no longer waits for FSM: written, given up, or set aside when ops cleared a check-in.
UPDATE alerts SET resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE resolved_at IS NULL
  AND substr(key, 1, instr(key, ':') - 1) = 'job_event_pending'
  AND NOT EXISTS (
    SELECT 1 FROM job_events e
    WHERE e.id = substr(alerts.key, instr(alerts.key, ':') + 1) AND e.fsm_write_state = 'pending' AND e.superseded = 0);
