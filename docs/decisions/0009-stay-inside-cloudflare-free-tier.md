# 0009. Stay inside Cloudflare's free tier

- Status: accepted; departed from 28 September 2026 by [0093](0093-the-storage-meter.md) for R2 storage alone: on the owner's ruling of 27 September 2026 (`docs/open-points.md`, item 151), R2's paid storage is accepted once Phase 2's share fills, and the storage meter tells ops at 50%, 80% and 100% of it
- Date: 2026-09-21

## Context

The owner requires that Cloudflare's free limits are never exceeded and that the card on the account is never charged.

On 21 September 2026 the account (`a2e185075b1b8eef3bee24b72f45ace3`) was confirmed to be on the **Workers Free** plan: Cloudflare rejected an upload that set a CPU limit, "CPU limits are not supported for the Free plan" (code 100328). Cloudflare's pricing pages state what happens at each limit:

| Product                   | Free allowance                                                                     | Past the allowance                                             |
| ------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Workers requests          | 100,000 a day                                                                      | requests fail                                                  |
| Workers CPU               | 10 ms per invocation                                                               | the invocation fails                                           |
| Workers Logs              | 200,000 events a day, 3-day retention                                              | events are dropped                                             |
| D1                        | 5M rows read and 100,000 written a day; 500 MB a database, 5 GB across the account | queries fail until 00:00 UTC; past the size, every write fails |
| Queues                    | 10,000 operations a day; 24-hour retention                                         | operations fail                                                |
| Static assets (mm-site)   | unlimited                                                                          | not applicable                                                 |
| **R2 (Standard storage)** | **10 GB-month; 1M Class A and 10M Class B operations a month**                     | **billed; there is no spending cap**                           |
| Access (Zero Trust)       | 50 users                                                                           | more seats are paid                                            |

On Workers Free every product except R2 fails closed, which is an outage rather than a charge. R2 charges the card, and the only way to stop that is not to use it past the allowance.

## Decision

1. **The account stays on Workers Free.** Upgrading to Workers Paid turns every "fails" row above into a bill. It needs a new ADR and the owner's sign-off.
2. **Only free-tier bindings.** `npm run check:config` allows mm-api exactly these binding kinds: vars, D1, R2, Queues and version metadata. Any other kind (Workers AI, Browser Rendering, Images, Vectorize, Hyperdrive, Analytics Engine, Durable Objects and so on) fails the build until this ADR is revised. A `limits` block fails too, since it is Paid-only. mm-site binds only its assets and mm-api (docs/decisions/0027-referral-landing.md).
3. **R2 has an application-level hard cap (M3, before R2 is first used):**
   - Global daily ceilings on upload URLs, renders and result reads, kept in D1 counters. On breach the API answers `503 busy`, the same as the render ceiling.
   - Worst-case monthly usage from those ceilings (operations, and storage from ceiling × maximum object size × retention) must stay under 80% of each R2 allowance. A test proves this from the configured numbers, so a ceiling cannot be raised past the free tier without the build failing.
   - Uploads are deleted once their job ends, not left for the 30-day lifecycle rule, to keep storage low.
   - Buckets stay on Standard storage; the free tier does not cover Infrequent Access, so no lifecycle rule may transition objects to it.
4. **Queues and D1 budgets are part of the design.** Render polling (M3) re-delivers messages and each delivery costs operations, so polling intervals and the render ceiling are sized to keep all three queues together under 10,000 operations a day.
5. **The owner sets two alarms**, in case something outside the code bills:
   - a Cloudflare budget alert at the lowest dollar amount (Billing → Budget alerts);
   - usage notifications for R2 storage and operations at 50% of the free allowance (Notifications → Usage-based billing).
6. **At most 64 vars and secrets on a Worker.** Workers Free allows one Worker 64 variables, text and secret together; past that a deploy is refused (code 10055) before anything moves, as staging's was on 26 September 2026 at 65. `npm run check:config` counts each mm-api environment's vars with every secret `.dev.vars.example` names and fails over 64. A value that is the same in every environment, or that only a release changes, is a constant in `src/config`, not a var. **Amended 27 September 2026:** the nine rate limits that were the same everywhere (login codes, leads and the try-on) went to `src/config/limits.ts`, leaving 28 vars beside the 26 secrets: 54. A local run may still raise one with a var of the same name, as the browser tests do; the startup guard refuses such a var anywhere else.

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
- **`test/worker/cron-reads.test.ts`** runs every cron job over a finished history and again over twice that history, and fails when a run reads more for it. A quiet run reads about 70 rows, and 100 in the evening (`CRON_ROWS_READ_PER_QUIET_RUN`, `scripts/lib/free-tier-budget.ts`).
- **`scripts/lib/free-tier-budget.ts`** models the cron's reads: production busy on every run (5,000 rows) and staging at rest, about 1.5 million a day. `test/node/free-tier-budget.test.ts` holds that under 40% of the allowance, which leaves requests the rest of the 80%.

## Update, 2 October 2026: D1's size

The table said 5 GB for D1. That is the account's total across its databases; one database may hold 500 MB, and past it every write fails, the audit entry each ops call writes first among them, so the console, booking and payments stop together. The hourly `storage_meter` cron job now reads the database's size, which D1 gives with any statement's answer, and tells ops once at 50%, 80% and 95% (`src/policy/database-size.ts`, the alerts `d1_size:<mark>`). Settings shows it beside the R2 meter. The runbook's "D1 growing" says what to do.

## Update, 4 October 2026: a flood

The table's first row is the account's, staging and production together, and every surface spends it: mm-api on every host, the site's pages that run its Worker first (`/`, `/book`, `/r/*`), the three apps, and the vendors' webhooks. A plain loop of about 100,000 requests, some eight minutes at 200 a second, spends the day's, and every surface then answers Cloudflare's error 1027 until 05:30 IST. No limit in the code can prevent it: Cloudflare counts a request before the Worker runs.

The owner ruled on 2 October 2026 to keep one free account, with no Workers Paid, so an outage from a deliberate flood stays accepted, as Consequences says. What narrows it:

- **The free plan's one rate-limiting rule** (`docs/runbook.md`, step 15): requests to `/api/*` other than `/api/hooks/*`, counted per address, at most 50 in 10 seconds, then the address is blocked for 10 seconds. A blocked request is refused at the edge, before any Worker, and is not counted. One address then gets about 2.5 requests a second through, so it needs some 11 hours rather than eight minutes to spend the day's. Many addresses together are not stopped. The webhooks are left out so that a burst of payments is never refused.
- **What an anonymous request writes.** An invite's open counts once a day for each address and code, and an address guessing codes is refused every code for the rest of the hour (ADR 0048), so a loop over `/api/r/:code` no longer writes a row each time.
- **The runbook's "Workers daily limit reached (1027)"** says how to tell and what to do.

Workers requests are not yet among the allowances the hourly check tells ops about at 70% (the runbook's "The daily allowances").

## Update, 4 October 2026: the cron's CPU time

On 3 October 2026 Cloudflare began holding the five-minute cron to the free plan's 10 ms: every staging run from 09:55 to 19:55 UTC ended `exceededCpu` at 10 ms, so no background job ran for ten hours. The runs it let finish used 34 and 61 ms.

**What a run costs**, measured two ways:

- Staging's own tail: an invocation costs about 1 ms, and about 0.35 ms more for each statement it sends D1 (the cheapest request with 7 statements took 3 ms, with 16 to 18 took 6 to 7 ms). A run of every job sent 56 or 57.
- In Node, each job run as one invocation would run it, on a stand-in for D1, timing only the Worker's own JavaScript (zod without code generation, as in Workers): the whole run cost 11 to 12.5 ms the first time and 1.3 ms once V8 had compiled it. Cloudflare's 34 to 61 ms is the first-time figure and the statements together: a cron run meets most of its code for the first time in the isolate it lands in.
- Over an empty run's 2.5 ms, most jobs added 0.1 to 0.8 ms; the sweeper 1.4 ms and 16 statements, the WhatsApp bridge 1.3 ms, the FSM reconciliation 3.8 ms. Making every provider on every invocation was 0.8 ms of the empty run.

**Decision.**

- The trigger fires every minute (`* * * * *`), still one of the account's five cron triggers for each environment, and each run takes only the jobs due in its minute. Each job has `every` (5, 15 or 60 minutes) and `at` (its minute in that period), so no minute holds more than four jobs or sends more than 16 statements (`CRON_STATEMENTS_PER_RUN`, held by `test/worker/cron-reads.test.ts`). The FSM reconciliation has its minute alone. The sweeper's eleven steps are jobs of their own, and the hourly checks that once read the clock's minute (the storage meter, the daily allowances, the AILabTools balance, FSM's catalogue, Books' items) run by the table.
- A run reads its record and its failing jobs in one round trip, makes each provider only when a job first uses it, and starts no outside call after 30 seconds, so it ends before the next minute's.
- Measured as above, a typical minute costs 2.6 ms the first time and 0.15 ms after, with 5 to 11 statements; the heaviest are FSM's reconciliation and catalogue, 6 to 8 ms, which go when FSM is switched off.
- A run on any other schedule runs every job, as before: `npm run tick`, and the five-minute trigger until an operator attaches the new one (ADR 0010).

**Rejected.** Each job as a message of its own on a queue: 3 operations a message, and the table's 4,032 job runs a day would be about 12,000 operations for staging alone, past the account's 10,000. A service binding to the Worker itself: not a binding kind this ADR allows, and Cloudflare does not say a called invocation gets its own CPU allowance. Workers Paid: the owner ruled on 2 October 2026 to keep one free account.

**What it costs the day**, per environment: 1,440 invocations (both environments together, 2.9% of the account's 100,000 requests); each writes its record twice, 2,880 rows (both together, 5.8% of the 100,000 written); and each reads its record and failing jobs, about 7,200 rows. The jobs read no more than before, since none runs more often than every five minutes (`cronRowsReadPerDay`). No queue operation is added. Workers Logs gain one line a minute, and each job writes its own only when it did something.

**Measured on staging, 3 and 4 October 2026.** An hour of `wrangler tail` (73 runs, 22:50 to 00:00 UTC) put Cloudflare's charge at two to three times the Node figures above, and showed what it goes on:

- A run that only reads D1 cost 3 to 6 ms, even with four jobs and 14 statements: its own record about 3 ms, each such job about half a millisecond more.
- A job that calls a vendor cost several milliseconds: the FSM reconciliation's page of 50 appointments 7 to 12 ms alone, FSM's catalogue 13 to 18, a Books pass making four calls 21, the AILabTools balance about 3. A minute with the WhatsApp bridge's check ran 5 to 7, more with a vendor call beside it.
- For a minute or two after each deploy, every run cost 12 to 18 ms, whatever it ran: each started in a new isolate. Staging deployed about every 15 minutes that hour.

So the table was rebalanced: no minute holds more than three jobs; a job that calls a vendor every time it runs (`CALLS_EVERY_RUN`, `src/scheduled/schedule.ts`) shares its minute with one job at most, and the FSM reconciliation has its minute alone, reading pages of 10; three five-minute jobs (the job steps, unfinished moves and leads re-sent) run every fifteen, and the day-scale ones every hour (try-on expiry, kept looks, the erasures' follow-ups, the asked windows, the next service's and the credits' reminders). A minute's run makes at most 6 outside calls (`CRON_CALLS`), one record's worth, so a busy run costs about what one record's calls do. The heartbeat, itself a vendor call, says all is well once in five minutes, the monitor's period, and `/fail` at once.
