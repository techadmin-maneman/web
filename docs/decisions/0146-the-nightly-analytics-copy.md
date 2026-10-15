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
8. **Production copies; staging and local runs do not.** The API writes as `analytics_writer`, which may read and write the `analytics` schema and nothing else, through the Hyperdrive config `mm-analytics` with caching off, since the night reads back what it has just written. No data agreement is needed with Supabase or Zoho (the owner's ruling). There is no staging copy; the owner kept one Supabase project.

## Consequences

- `npm run analytics:first-run` copies one of every record into the real schema twice, as the API's login, reads it back through Zoho's, and takes it out again. Its first run found that a list sent as an array, with the server's types off as a pooler needs, arrives as one string; tonight's keys go as JSON.
- Zoho reads the `reporting` views, which point at the sample schema until the copy carries real activity, then at `analytics`.
- Channels and campaigns follow ADR 0148, and a lead's area is its client's address's. A piece's failure reason is the technician's own words, so it stays out, and a visit's booking window is left empty.
- The schema is in `warehouse/migrations`, numbered: `npm run warehouse:migrate` applies the ones the project has not had, as the postgres login, and records them in `warehouse.migrations`; `npm run warehouse:check` says whether the live schema is what they make. The project's schema was made by hand before the files, and matched them when they were written.
- Tests: `test/worker/jobs/analytics-nightly.test.ts`, and `test/node/api/warehouse-postgres.test.ts`, which runs the writer's statements and a whole night of the job on a Postgres made from the migrations, in the test's own process (PGlite).
