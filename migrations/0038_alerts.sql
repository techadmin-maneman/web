-- Migration number: 0038
-- Alerts kept in D1, so each failure that needs a person reaches one once,
-- with the IDs to act on (docs/decisions/0067-alerts-and-silent-failures.md).
-- Only new tables, a new column and indexes, so the code already deployed is
-- unaffected.

-- One row per alert while it is open, and kept once it is resolved. `key` names
-- what went wrong and to what, "books_refund_refused:<refundId>"; raising it
-- again counts it. The message holds IDs and never a name, number or address.
CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  message TEXT NOT NULL,
  -- A path in the ops console, "/clients/<personId>", where ops act on it.
  link TEXT,
  count INTEGER NOT NULL CHECK (count > 0),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  resolved_at TEXT
);

-- One open alert per key; a resolved one that happens again is a new row.
CREATE UNIQUE INDEX alerts_open_by_key ON alerts (key) WHERE resolved_at IS NULL;

-- The five-minute cron's jobs, one row each once it has run: how many runs in a
-- row it has failed, so one that keeps failing alerts (src/scheduled/cron.ts).
CREATE TABLE cron_jobs (
  job TEXT PRIMARY KEY,
  failed_runs INTEGER NOT NULL DEFAULT 0,
  last_failed_at TEXT,
  -- The error's message, scrubbed of numbers and e-mail addresses.
  last_error TEXT
);

-- When a booked lead was put on the fsm-sync queue. Empty on a lead whose
-- queueing failed, which the sweeper then queues (src/scheduled/sweeper.ts).
ALTER TABLE leads ADD COLUMN fsm_queued_at TEXT;

-- Every lead so far was queued as it was made, or was never meant for FSM.
UPDATE leads SET fsm_queued_at = created_at;

CREATE INDEX leads_fsm_unqueued ON leads (created_at)
  WHERE fsm_queued_at IS NULL AND fsm_request_id IS NULL AND source = 'form' AND first_choice_window IS NOT NULL;
