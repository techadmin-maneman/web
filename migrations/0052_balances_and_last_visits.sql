-- Migration number: 0052
-- withdrawn: deploy-staging run 36389520282 refused it, and it has been applied nowhere.
--
-- It added stock_balances and last_visits, kept by triggers (plan piece C27).
-- One trigger used CASE … END, and wrangler splits a migration into statements
-- before D1 runs it: it took that END for the trigger's own, so everything
-- after it went to D1 as one statement, which D1 refused ("incomplete input").
-- The local database runs a file whole, so CI did not see it. The same tables
-- and triggers, with iif() in place of CASE, are migration 0053, and
-- test/node/migration-statements.test.ts now splits every migration as
-- wrangler does.

SELECT 1;
