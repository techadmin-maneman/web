# 0193. The rest of the rules in the console

- Status: accepted
- Date: 2026-10-13
- Topic: The ops console

## Context

ADR 0088 put every policy ops might change in Settings › Rules. Rules added since were left in the code: how long a payment link holds its slot, when a referrer's month is held, when credits are reminded, how long a move proposal stays open, how often a number may have a look, the stock alerts' and reports' windows, the count cadences and the forecast's assumptions. The owner asked that no business rule be fixed in code.

## Decision

1. **Each is a rule in the register,** `src/policy/ops-settings.ts`, with its committed figure as the fallback and bounds a typing slip cannot pass: `payment_links`, `arrival_notice_min`, `move_proposal_hours`, `kit_check`, `credit_reminder_days`, `referral_monthly_cap`, `tryon_look_days`, `stock_watch`, `stock_usage`, `stock_quality`, `cycle_counts`, `scorecard_days` and `forecast_assumptions`.
2. **Read where they are used,** through `readOpsInputs`, so a change reaches the next request or cron pass within the cache's minute, with no deploy.
3. **A link keeps its own close.** `payment_links.closes_at` records when each link stops taking payment, as Razorpay was told, so a change to how long links stay open never misjudges one already sent (migration 0157). A link from before the column is judged by the fourteen days it was made with.
4. **Rates as percentages.** The forecast's two learned-rate defaults are set as whole percentages, as ops say them.
5. **What stays in code.** Limits that guard the system rather than the business: rate limits, timeouts, batch sizes, Razorpay's shortest link. Periods the law or a notice promises: retention, erasure, the try-on result's fourteen days. The page's paging sizes, and who may own a task (ADR 0092).

## Consequences

- Until ops set one, each rule is its committed figure.
- The Rules page gains a Stock section, and the new rules sit in their subjects' sections.
- Tests: `test/node/apps/ops/ops-settings.test.ts`, `test/node/apps/ops/ops-rule-groups.test.ts`, and each rule's own reader's tests.
