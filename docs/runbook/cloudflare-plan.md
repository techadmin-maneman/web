# Cloudflare's plan

Part of the [runbook](../runbook.md), whose opening says how its commands are written.

The account is on Workers Paid, and the zone on the Free website plan (`docs/decisions/0112-workers-paid.md`). Past an allowance Cloudflare bills rather than refuses. R2's own rules are still ADR 0009's.

Once, in the Cloudflare dashboard:

1. Billing → Budget alerts: an alert at $10 a month, twice the subscription. Any usage-based charge then emails the billing address.
2. Notifications → Add → Usage-based billing: one notification each for R2 storage (5 GB), R2 Class A operations (500,000) and R2 Class B operations (5,000,000). That is half of each monthly allowance.
3. Billing → Subscriptions should list Workers Paid and no other paid plan. Another needs a new ADR.

Cloudflare is not the only card now. The owner's own card is on Google Maps Platform for the address search, and Google bills past its free allowance rather than stopping. Its quotas and its kill switch are provisioning, step 13, and its ceiling is `GEOCODE_DAILY_CEILING`.

If an R2 alert fires: set `UPLOAD_DAILY_CEILING`, `RENDER_DAILY_CEILING` and `RESULT_READ_DAILY_CEILING` to `"0"` in `wrangler.jsonc` and deploy. New uploads, renders and result reads then answer `busy`. Find the cause before raising them again. `test/node/tooling/free-tier-budget.test.ts` refuses any ceiling that could take R2 past 80% of its free allowance, counting the share set aside for Phase 2 (`docs/decisions/0015-render-pipeline.md`, `docs/decisions/0039-phase-2-budget.md`).

## Workers daily limit reached (1027)

Workers requests, 100,000 a day, are the account's too, staging and production together, and every surface spends them: the API on every host, the site's home, `/book` and `/r/*` pages, and the three apps. On Workers Free, past them Cloudflare answered every request a Worker would have served with **error 1027** until midnight UTC. On Workers Paid (ADR 0112) there is no daily limit: a flood is billed, at each million requests past the month's 10 million, instead of stopping every surface. The steps below still find and block one.

1. **Confirm it.** Cloudflare dashboard → **Workers & Pages** → **Overview** shows the day's requests near 100,000. A page that answers 1027 on one host answers it on all of them.
2. **Find who is spending them.** `maneman.in` → **Security** → **Analytics** (or **Analytics & Logs** → **HTTP Traffic**): group by source IP, then by path and user agent. The rate-limiting rule's blocks (provisioning, step 15) show there too. A test run on staging is the usual cause: stop it.
3. **Block the attacker.** **Security** → **Security rules** → **Create rule** → **Custom rules** (the free plan has five): match the addresses, their AS number or their country, action **Block**. This stops them spending tomorrow's allowance as well. Keep the rule until the traffic has stopped for a day, then delete it.
4. **Many addresses at once** cannot be held off by a rule per address. Lower the rate-limiting rule's **Requests** for the day, and tell the owner what it is costing.
5. **After the reset,** check the cron ran (the heartbeat, [The outside watchers](alerts.md#the-outside-watchers)) and that Razorpay's retried webhooks arrived ([Razorpay's webhook is not arriving](razorpay.md#razorpays-webhook-is-not-arriving)).

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

**The storage meter** (ADR 0093) is a running figure of what this environment's `client-photos` and `referral-cards` hold. It tells ops once at 50%, 80% and 100% of the share (the alerts `r2_share:50`, `r2_share:80` and `r2_share:100`), and Settings › Rules shows it under The console. **Past the share R2 bills, as the owner accepted** (open point 151): nothing is refused. Past the runaway ceiling, 20 GB, the technician app's uploads answer `503 busy` and wait on the phones, and ops are told (`r2_runaway_ceiling`): something is writing far more than the business makes. Find it before anything else. The usage notifications above, at 5 GB for the account, stay as the backstop.

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
2. Never delete a client's photographs to make room: they are the client's record, promised kept. The owner decided on 27 September 2026 to pay for R2 past the free allowance (open point 151; ADR 0093), so the bill is the cost of keeping them.

## D1 growing

Each environment's database may hold 10 GB on Workers Paid (ADR 0112). Past it every write fails, the audit entry each ops call writes first among them, so the console, bookings and payments stop together. The `storage_meter` cron job reads its size once an hour, on the half hour, and tells ops once at 50%, 80% and 95% (the alerts `d1_size:50`, `d1_size:80` and `d1_size:95`). Settings shows it beside the R2 meter.

Where it stands: `npx wrangler d1 info maneman-staging --env staging` (or production's) gives the size. What fills it is usually the audit log:

```sql
SELECT COUNT(*) AS entries, MIN(at) AS oldest FROM audit_log;
SELECT action, COUNT(*) AS entries FROM audit_log GROUP BY action ORDER BY entries DESC LIMIT 10;
```

At 50%, tell the developers. Never delete rows by hand to make room: the audit log and the credit ledger refuse it by trigger, and the rest are clients' records and the history of their money. The audit log's retention, two years once counsel confirms it, is what takes rows off it. At 80%, the owner decides between that and Workers Paid, which holds 10 GB a database and needs a new ADR (ADR 0009).

A mark is told once for good; to hear of one again after the database shrank below it, `UPDATE storage_meter SET database_told_percent = 0 WHERE id = 1;`.

---
