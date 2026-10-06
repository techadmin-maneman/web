# 0112. Workers Paid

- Status: accepted, on the owner's purchase of 6 October 2026
- Date: 2026-10-06
- Amends [0009](0009-stay-inside-cloudflare-free-tier.md): its first decision, the account's plan

## Context

ADR 0009 kept the account on Workers Free, where every product but R2 refuses work past its allowance rather than billing for it. The platform was built around those limits:

- **10 ms of CPU an invocation.** The cron runs only the jobs due in its minute, and each job stops at a call budget. On 3 October 2026 Cloudflare stopped every staging run for ten hours when one run of every job took 30 to 60 ms.
- **50 D1 queries an invocation,** which the same budgets and slices keep each run under.
- **Daily allowances,** shared by staging and production: 100,000 Workers requests, 10,000 queue operations, 5 million D1 rows read and 100,000 written. Past one, Cloudflare refuses that work until midnight UTC. A flood from one address could spend the day's requests and take every surface down (error 1027).
- **500 MB a database, 3 days of logs, 7 days of D1 Time Travel.**

The owner bought Workers Paid on 6 October 2026, on the recommendation that these limits are outages waiting to happen once real clients book.

## Decision

1. **The account is on Workers Paid**, at $5 a month. The zone `maneman.in` stays on the Free website plan, and Access on Zero Trust's free plan.
2. **What it gives,** per month for the account, before anything is billed: 10 million requests, 30 million CPU milliseconds, 25 billion D1 rows read and 50 million written, 1 million queue operations, and 20 million log events. Each invocation may use 30 seconds of CPU and 1,000 D1 queries. A database may hold 10 GB, Time Travel reaches back 30 days, and logs are kept 7 days.
3. **Past an allowance, Cloudflare bills, at the rates on its pricing pages; it no longer refuses.** Staging uses about 192,000 D1 rows read and 6,500 written a day, nowhere near them. The card on the account is now charged the subscription, and could be charged more. Billing → Budget alerts keeps an alert at $10 a month, twice the subscription, so any usage charge e-mails the billing address.
4. **R2 is unchanged.** Its ceilings and the storage meter (ADR 0093) stay as they are.
5. **The code drops the free plan's limits in phase 7 of `docs/codebase-upgrade-plan.md`.** That covers the daily-allowance alerts, the 500 MB database limit, the CPU report's 10 ms, and the cron's per-minute slicing and call budgets. A budget stays only where a vendor's own limit needs it, such as Zoho's 100 calls a minute. Until then the alerts measure the free limits, which are lower, so they warn early and never late.

## Consequences

- A flood can no longer stop every surface for the rest of the day. It costs money instead. The rate-limiting rule and the custom rules of the runbook's "Workers daily limit reached" still block it.
- A heavy job can run as one pass, and restoring D1 can reach back a month.
- `npm run check:config` still allows mm-api only the binding kinds it uses today. Adding another kind needs its own ADR.
