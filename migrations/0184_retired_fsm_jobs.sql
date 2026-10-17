-- The two cron jobs FSM's catalogue sync and reconcile ran as, retired with FSM, still listed their last failures on
-- the console's health view. No code runs them, so the rows go.
-- contract: docs/decisions/0110-field-work-without-fsm.md
DELETE FROM cron_jobs WHERE job IN ('fsm_catalogue', 'fsm_reconcile');
