# 0146. The nightly analytics copy

- Status: accepted
- Date: 2026-10-12
- Topic: Platform

## Context

The owner chose to report from Zoho Analytics, fed by a nightly copy of our figures in Supabase's Postgres, with no client's name, number or address in it. Zoho also reads Books, the CRM and the ad accounts through its own connectors, so every dashboard is built there. The copy's tables are a star schema: shared tables of dates, cities, technicians, services and clients, and a row per visit, payment and so on. Supabase's free plan holds 500 MB and 5 GB of egress a month.

## Decision

1. **Once a night, in the hour from 3 am in India**, the cron's `analytics_nightly` job works out every row of the copy from D1 and writes it to the `analytics` schema, which Supabase's Data API does not expose. A run is logged in the copy's `load_run`, and a night already logged is not run again.
2. **The Worker reaches Postgres through Hyperdrive**, with the postgres package (which needs `nodejs_compat`). `ANALYTICS_PROVIDER` is `supabase`, `stub` (local runs and tests) or `none`. The connection string comes from the `ANALYTICS_DB` binding.
3. **Each table is made to hold exactly tonight's rows.** A new or changed row is written, a row no longer worked out is deleted, and an unchanged row is left alone. On the visits, payments and clients, `updated_at` moves only when a row changes, so Zoho fetches only what changed. The small shared tables are reloaded whole.
4. **No row names a client.** A client is a key: an HMAC of our ID with `ANALYTICS_CLIENT_KEY`, a secret only the API holds, so the key is the same every night and cannot be turned back into a person. Records marked as tests are left out. An erased client's visits and payments stay as the business's record, with no key; their client row goes.
5. **Money is in rupees before GST**, with the GST and any refund in columns of their own.
6. **Each night's copy is checked**: the visits it holds and the payments' total, against what it was sent. A difference alerts (`analytics_totals`), as does a copy past 400 MB (`analytics_size`).
7. **A technician's day is read from the dispatch board**, so the copy's utilisation is the board's: the half-slots open, none on a day of leave, and those taken. A day already worked keeps the figures it closed with; each night rewrites yesterday and the four weeks ahead, and the first night fills every day since the first visit.
8. **Production stays on `none` until counsel answers on pseudonymous rows and the data agreements with Supabase and Zoho.** There is no staging copy; the owner kept one Supabase project.

## Consequences

- Switching it on needs a writer role in Supabase for the API, a Hyperdrive config, the binding in wrangler.jsonc and the secret. Zoho's views then move from the sample schema to `analytics`.
- Care cases follow once the Care numbers page has landed. Until the growth figures are built, every client's channel is "direct", and a visit's booking window is empty.
- Tests: `test/worker/jobs/analytics-nightly.test.ts`, `test/node/api/warehouse-sql.test.ts`.
