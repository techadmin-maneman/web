# 0009. Stay inside Cloudflare's free tier

- Status: accepted
- Date: 2026-09-21

## Context

The owner requires that Cloudflare's free limits are never exceeded and that the card on the account is never charged.

On 21 September 2026 the account (`a2e185075b1b8eef3bee24b72f45ace3`) was confirmed to be on the **Workers Free** plan: Cloudflare rejected an upload that set a CPU limit, "CPU limits are not supported for the Free plan" (code 100328). Cloudflare's pricing pages state what happens at each limit:

| Product                   | Free allowance                                                 | Past the allowance                   |
| ------------------------- | -------------------------------------------------------------- | ------------------------------------ |
| Workers requests          | 100,000 a day                                                  | requests fail                        |
| Workers CPU               | 10 ms per invocation                                           | the invocation fails                 |
| Workers Logs              | 200,000 events a day, 3-day retention                          | events are dropped                   |
| D1                        | 5M rows read and 100,000 written a day; 5 GB                   | queries fail until 00:00 UTC         |
| Queues                    | 10,000 operations a day; 24-hour retention                     | operations fail                      |
| Static assets (mm-site)   | unlimited                                                      | not applicable                       |
| **R2 (Standard storage)** | **10 GB-month; 1M Class A and 10M Class B operations a month** | **billed; there is no spending cap** |
| Access (Zero Trust)       | 50 users                                                       | more seats are paid                  |

On Workers Free every product except R2 fails closed, which is an outage rather than a charge. R2 charges the card, and the only way to stop that is not to use it past the allowance.

## Decision

1. **The account stays on Workers Free.** Upgrading to Workers Paid turns every "fails" row above into a bill. It needs a new ADR and the owner's sign-off.
2. **Only free-tier bindings.** `npm run check:config` allows mm-api exactly these binding kinds: vars, D1, R2, Queues and version metadata. Any other kind (Workers AI, Browser Rendering, Images, Vectorize, Hyperdrive, Analytics Engine, Durable Objects and so on) fails the build until this ADR is revised. A `limits` block fails too, since it is Paid-only. mm-site has no bindings at all.
3. **R2 has an application-level hard cap (M3, before R2 is first used):**
   - Global daily ceilings on upload URLs, renders and result reads, kept in D1 counters. On breach the API answers `503 busy`, the same as the render ceiling.
   - Worst-case monthly usage from those ceilings (operations, and storage from ceiling × maximum object size × retention) must stay under 80% of each R2 allowance. A test proves this from the configured numbers, so a ceiling cannot be raised past the free tier without the build failing.
   - Uploads are deleted once their job ends, not left for the 30-day lifecycle rule, to keep storage low.
   - Buckets stay on Standard storage; the free tier does not cover Infrequent Access, so no lifecycle rule may transition objects to it.
4. **Queues and D1 budgets are part of the design.** Render polling (M3) re-delivers messages and each delivery costs operations, so polling intervals and the render ceiling are sized to keep all three queues together under 10,000 operations a day.
5. **The owner sets two alarms**, in case something outside the code bills:
   - a Cloudflare budget alert at the lowest dollar amount (Billing → Budget alerts);
   - usage notifications for R2 storage and operations at 50% of the free allowance (Notifications → Usage-based billing).

## Consequences

- An outage at a free limit is possible and accepted; a charge is not. Alerts (M2/M3) report when a ceiling trips.
- Production's render ceiling is set by the smaller of the AILabTools budget and the R2 and Queues budgets. M3 records the arithmetic.

## Update, 21 September 2026 (M3)

- **Presigned uploads replaced.** The prompt's presigned R2 upload link could be replayed until it expired, each replay a billed write that no ceiling could count. Photos now come through the API, which writes each once (docs/decisions/0014-try-on-api.md).
- **The arithmetic, and the test that enforces it.** Both are in docs/decisions/0015-render-pipeline.md; `test/node/free-tier-budget.test.ts` enforces them. R2 storage is the binding limit: it holds production to 40 renders a day while results are kept 30 days at up to 6 MB each.

## Update, 25 September 2026: D1's reads

D1's 5 million rows read a day had no budget, and the five-minute cron read whole tables that only grow. The sweep's photograph check alone read every try-on job ever made on each run: at production's ceiling, about 29,000 a year, or some 8 million rows a day within the year, past the allowance.

- **Migration 0037** gives each lookup on the cron's path, and the lookups made while a client pays, an index. Most are partial: they hold only the rows still waiting, so they stay small however much history gathers.
- **`test/node/query-plans.test.ts`** plans each statement on those paths against every migration, and fails when one reads a growing table from end to end.
- **`test/worker/cron-reads.test.ts`** runs every cron job over a finished history and again over twice that history, and fails when a run reads more for it. A quiet run reads about 35 rows.
- **`scripts/lib/free-tier-budget.ts`** models the cron's reads: production busy on every run (5,000 rows) and staging at rest, about 1.5 million a day. `test/node/free-tier-budget.test.ts` holds that under 40% of the allowance, which leaves requests the rest of the 80%.
