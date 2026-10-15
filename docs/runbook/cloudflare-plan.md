# Cloudflare's plan

Part of the [runbook](../runbook.md), whose opening says how its commands are written.

The account is on Workers Paid, and the zone on the Free website plan (`docs/decisions/0112-workers-paid.md`). Past an allowance Cloudflare bills rather than refuses. R2's own rules are still ADR 0009's.

Once, in the Cloudflare dashboard:

1. Billing → Budget alerts: an alert at $10 a month, twice the subscription. Any usage-based charge then emails the billing address.
2. Notifications → Add → Usage-based billing: one notification each for R2 storage (5 GB), R2 Class A operations (500,000) and R2 Class B operations (5,000,000). That is half of each monthly allowance.
3. Billing → Subscriptions should list Workers Paid and no other paid plan. Another needs a new ADR.

Cloudflare is not the only card now. The owner's own card is on Google Maps Platform for the address search, and Google bills past its free allowance rather than stopping. Its quotas and its kill switch are provisioning, step 13, and its ceiling is `geocode` in Settings · Rules · Daily limits.

If an R2 alert fires: set `UPLOAD_DAILY_CEILING`, `RENDER_DAILY_CEILING` and `RESULT_READ_DAILY_CEILING` to `"0"` in `wrangler.jsonc` and deploy. New uploads, renders and result reads then answer `busy`. Find the cause before raising them again. `test/node/tooling/usage-budget.test.ts` refuses any ceiling that could take R2 past 80% of its free allowance, counting the share set aside for Phase 2 (`docs/decisions/0015-render-pipeline.md`, `docs/decisions/0039-phase-2-budget.md`).

## A flood of requests

Workers Paid has no daily limit: requests past the monthly allowance, 10 million on the account, staging and production together, are billed. A flood of them shows first as the budget alert's email, or as the day's count in **Workers & Pages** → **Overview**. Every surface spends them: the API on every host, the site's pages and the three apps.

1. **Confirm it.** **Workers & Pages** → **Overview** shows the day's requests far above the usual.
2. **Find who is spending them.** `maneman.in` → **Security** → **Analytics** (or **Analytics & Logs** → **HTTP Traffic**): group by source IP, then by path and user agent. The rate-limiting rule's blocks (provisioning, step 15) show there too. A test run on staging is the usual cause: stop it.
3. **Block the attacker.** **Security** → **Security rules** → **Create rule** → **Custom rules** (the free plan has five): match the addresses, their AS number or their country, action **Block**. This stops them spending tomorrow's allowance as well. Keep the rule until the traffic has stopped for a day, then delete it.
4. **Many addresses at once** cannot be held off by a rule per address. Lower the rate-limiting rule's **Requests** for the day, and tell the owner what it is costing.
5. **Once it stops,** check the cron ran (the heartbeat, [The outside watchers](alerts.md#the-outside-watchers)) and that Razorpay's retried webhooks arrived ([Razorpay's webhook is not arriving](razorpay.md#razorpays-webhook-is-not-arriving)).

## R2 storage growing

R2's 10 GB a month is the account's, both environments together, and past it R2 bills. What fills it:

| Bucket                            | What                                                                                       | Kept                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `mm-<t>-tryon-uploads`            | Try-on photographs                                                                         | Deleted within the hour; the bucket's 30-day rule behind that                                                                    |
| `mm-<t>-tryon-results`            | Try-on results                                                                             | `RESULT_RETENTION_DAYS`: 3 on staging, 14 in production; the 30-day rule behind that                                             |
| `mm-<t>-client-photos`            | Visit photographs, ten a visit, each with its thumbnail from the technician app (ADR 0093) | For good: deleted only by an erasure, which deletes everything under the visit                                                   |
| `mm-<t>-client-photos`, `tryons/` | A try-on photograph's small copy, and a client's kept look (ADR 0084)                      | The copy as long as its look; a client's for good, and their look until their first fit is photographed; an erasure deletes both |
| `mm-<t>-referral-cards`           | One card for each referrer who made one                                                    | Until its referrer revokes it or is erased                                                                                       |

ADR 0039 gives the photographs and the cards 4 GB. At 250 KB a photograph and 32 KB its thumbnail, which is what the technician app sends, that is about 1,312 visits. A client's kept try-on is paid from the same share, and while its look is kept at full size, the share holds about 444 visits at worst (ADR 0084, ADR 0093). A photograph from the technician app is at most 2 MB.

**The storage meter** (ADR 0093) is a running figure of what this environment's `client-photos` and `referral-cards` hold. It tells ops once at 50%, 80% and 100% of the share, and at each whole share past it (the alerts `r2_share:50`, `r2_share:80`, `r2_share:100`, `r2_share:200`…), and Settings › Rules shows it under The console. **Past the share R2 bills, as the owner accepted** (open point 151): nothing is refused for what is held (ADR 0194). What is refused is a rate no day's work makes: a technician's phone past 480 uploads in a day, or the stock photographs past 300, answer `503 busy`, the photographs wait on the phone, and ops are told (`photo_uploads:<key>`). A day in which the figure grows by more than 2 GB is told too (`r2_growth:<day>`). Either means something is writing far more than the business makes: find it before anything else. The usage notifications above, at 5 GB for the account, stay as the backstop.

R2's free storage is the account's, so each environment's meter is read against its own part of the share (`SHARE_BYTES`, `src/policy/storage-share.ts`): staging a tenth, 400 MB, for its few test visits (2.7 MB on 4 October 2026), and production the rest, 3.6 GB. Together they stay inside the 4 GB.

What production's part holds, and what passing it costs, at about 2.8 MB a visit (ten photographs and their thumbnails), before try-on copies and cards:

| Visits photographed a month | Production's 3.6 GB is full after | Each month after, R2 bills about            |
| --------------------------- | --------------------------------- | ------------------------------------------- |
| 100                         | about 13 months                   | $0.004 more than the month before (0.28 GB) |
| 300                         | about 4 months                    | $0.013 more than the month before (0.85 GB) |
| 1,000                       | about 6 weeks                     | $0.042 more than the month before (2.8 GB)  |

At $0.015 a GB-month, a year past the share at 300 visits a month adds about 10 GB, under $0.20 a month. The runaway ceiling, 20 GB, is there for a fault, not for growth.

```sql
SELECT ROUND(bytes / 1e9, 2) AS gb, told_percent FROM storage_meter;
```

The figure is the sum of `stored_objects`, a row for each object with its size, kept beside it. It can drift from the bucket: an object written outside the meter's helpers, or a write whose D1 batch failed after R2 took it, is not counted until its key is written again. It started from the rows (migration 0055), with cards, copies and kept looks at their upload limits and without the photographs a retake replaced. The largest objects it counts: `SELECT key, bytes FROM stored_objects ORDER BY bytes DESC LIMIT 20;`. If the figure and the rows disagree, after a correction by hand or a batch that failed half-way, set the figure back to the rows' sum: `UPDATE storage_meter SET bytes = (SELECT COALESCE(SUM(bytes), 0) FROM stored_objects) WHERE id = 1;`.

The bucket sizes on the dashboard's R2 page are what bills, and they read higher than the rows: a photograph a retake replaced before migration 0055 has no row. Setting the figure to the bucket sizes instead (`UPDATE storage_meter SET bytes = <client-photos + referral-cards> WHERE id = 1;`) makes it tell ops at the true share, but the surplus over the rows is never taken off again, since an erasure takes off only what rows hold, so the figure stays that much high for good. Do it only knowing that, and note the surplus and the date where the team keeps such notes. A mark is told once for good; to hear of one again after the figure fell below it, `UPDATE storage_meter SET told_percent = 0 WHERE id = 1;`.

Where it stands: the dashboard's R2 page gives each bucket's size, which is the figure that bills. The photographs the database knows of:

```sql
SELECT COUNT(*) AS photographs, ROUND(SUM(bytes) / 1e9, 2) AS gb, ROUND(AVG(bytes) / 1e3) AS average_kb FROM photos;
SELECT p.id, p.bytes, s.appointment_id FROM photos p JOIN photo_sets s ON s.id = p.photo_set_id ORDER BY p.bytes DESC LIMIT 20;
-- Clients' kept try-ons, and how many of their looks still wait for a first fit (ADR 0084).
SELECT COUNT(*) AS kept_try_ons, SUM(kept_look_key IS NOT NULL) AS looks_waiting FROM tryon_jobs WHERE kept_at IS NOT NULL;
```

A bucket much larger than its rows is holding files nothing points at any more; tell the developers.

If the total nears 8 GB:

1. Stop the try-on as above. Its results then leave over the retention days and give their share back.
2. Never delete a client's photographs to make room: they are the client's record, promised kept. R2 is paid for past the free allowance (open point 151; ADR 0093), so the bill is the cost of keeping them.

## D1 growing

Each environment's database may hold 10 GB on Workers Paid (ADR 0112). Past it every write fails, the audit entry each ops call writes first among them, so the console, bookings and payments stop together. The `storage_meter` cron job reads its size once an hour, on the half hour, and tells ops once at 50%, 80% and 95% (the alerts `d1_size:50`, `d1_size:80` and `d1_size:95`). Settings shows it beside the R2 meter.

**Where it stands.** `npx wrangler d1 info maneman-prod --env production` gives the size; `node scripts/ops/table-sizes.ts --env production` gives each table's rows, the largest first. It reads every row once, so run it at an alert, not on a schedule.

**What already lets go.** The hourly `retention` job deletes, a few hundred rows a run (`src/policy/retention.ts`): the audit log after two years, messages we sent after two years unless a no-show or a move holds one as evidence, resolved alerts and Razorpay's event IDs after a year, strangers' closed chats after a year, dormant people who never became clients after a year, and the counters after three days.

**What already moves out.** The hourly `chat_archive` job moves the messages of clients' Care threads closed and quiet for a year into the backups bucket, one file a thread, read back where the thread is shown ([ADR 0207](../decisions/0207-closed-chats-archived.md)). `SELECT COUNT(*), SUM(archived_messages) FROM conversations WHERE archive_key IS NOT NULL` says how many threads, and how many messages, it has moved.

**What only grows.** Clients' records and the history of their money stay as long as the client does: visits, payments, `credit_ledger`, `stock_movements`, `job_events` (each technician step, read again for the visit's record), `chat_messages`, `task_spans` and `stored_objects` (a row for each object in R2). Never delete them by hand to make room: the audit log and the credit ledger refuse it by trigger, and the rest are records someone will ask for.

**The plan, by mark.**

- **At 50%**, run `table-sizes.ts` and tell the developers which tables lead. If it is the audit log or the messages, the retention job is behind: check `cron_job:retention` has not been failing.
- **At 80%**, the owner decides between these, in this order. Each is a few days' work, built when it is chosen; neither runs today.
  1. **Archive closed rows to R2.** Built for Care threads (ADR 0207), which the `chat_archive` job already moves. `job_events` would follow the same way, once each visit carries the outcome, start time and checklist now read from those rows (ADR 0207, Context).
  2. **Move the high-volume append-only tables to a second D1 database.** A second database (`maneman-prod-history`), bound as `HISTORY_DB` and checked like the first by `scripts/ci/check-wrangler-config.ts`; for each table moved, its module reads and writes through the new binding, the rows are copied over with `wrangler d1 export --table` and imported, and the old table is dropped in a later contract migration (docs/migrations.md). `job_events`, `outbound_messages` and `chat_messages` move first: nothing joins them to a booking or a payment in the same statement.
- **At 95%**, the console and bookings are days from stopping: archive first, as it frees the most for the least change.

A mark is told once for good; to hear of one again after the database shrank below it, `UPDATE storage_meter SET database_told_percent = 0 WHERE id = 1;`.

---
