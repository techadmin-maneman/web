# 0194. The build on Workers Paid

- Status: accepted
- Date: 2026-10-13
- Topic: Platform
- Amends [0009](0009-stay-inside-cloudflare-free-tier.md) and [0093](0093-the-storage-meter.md)

## Context

ADR 0112 moved the account to Workers Paid, and phase 7 of the upgrade plan took the free plan's limits out of the cron. The build still held to them. `npm run check:config` allowed only the binding kinds that are free on Workers Free, refused a `limits` block, and failed past 64 variables and secrets, so values that belong in a Worker's config were written as code. The R2 budget held the try-on's ceilings under 80% of R2's free 10 GB. And the storage meter refused every technician's photographs once the bucket passed 20 GB, about 7,000 visits: under a month's work at a hundred technicians.

## Decision

1. **Binding kinds are costed, not forbidden.** A binding kind with no charge of its own may be used. One that bills (Durable Objects, Workflows, KV, Analytics Engine, Vectorize, Browser Rendering, AI) is allowed once `COSTED_BINDINGS` in `scripts/lib/wrangler-config-check.ts` names what it costs and the record that took it on. `unsafe` stays refused.
2. **`limits.cpu_ms` is allowed,** up to the five minutes Workers Paid permits an invocation.
3. **Workers Paid's limit on variables,** 128 vars and secrets together, replaces the free plan's 64.
4. **The R2 budget is a monthly cost.** `scripts/lib/usage-budget.ts` prices the try-on's worst case at its ceilings, with the photographs' share beside it, at R2's rates past its free allowance, and its test holds the whole to `R2_MONTHLY_BUDGET_USD`, half the account's $10 budget alert. A ceiling may now rise if what it costs is accepted.
5. **No runaway ceiling.** The storage meter tells ops at half, four fifths and all of the photographs' share, and at each whole share past it, but refuses nothing. What catches a broken build or a misused link is a rate: a technician's phone may upload `PHOTO_UPLOADS_PER_TECHNICIAN_DAILY` a day, a busy day's photographs twice over, and ops' stock photographs `STOCK_PHOTO_UPLOADS_DAILY` a day between them. Past either, the upload is refused, the photographs wait on the phone, and ops are told. And a day in which the photographs grow by more than `UNUSUAL_DAILY_GROWTH_BYTES` is told too.
6. **No move to Infrequent Access yet.** R2's Infrequent Access class has no free allowance, so moving photographs to it after 90 days would bill storage that is free today. The rule is set once production's photographs pass the free 10 GB, when it saves a third of their storage (`docs/go-live.md`).

## Consequences

- A new binding kind's cost is reviewed where it is added.
- A value that differs by environment can be a var again; the constants written to stay under 64 stay until each is next changed.
- The photographs' growth is read daily, not refused; a full share is a cost to accept or a clean-up to make, never an outage.
- Tests: `test/node/tooling/wrangler-config-check.test.ts`, `test/node/tooling/usage-budget.test.ts`, `test/worker/platform/storage-meter.test.ts`.
