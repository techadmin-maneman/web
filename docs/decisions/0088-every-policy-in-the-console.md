# 0088. Every policy in the console

- Status: accepted, on the owner's standing rule of 27 September 2026
- Date: 2026-09-28
- Amends [0061](0061-ops-editable-inputs.md), whose store read a row per input and so held ten inputs at most

## Context

The owner, on 27 September 2026: "All the policies can change and I want them to be an ops update, not a tech update" (ADR 0025, item 66; `docs/open-points.md`, item 12).

ADR 0061's store read one row per input on every cache miss, so it claimed a fifth of D1's day for at most ten inputs, and held six.

## Decision

### The store: one row a request reads

`ops_settings` keeps one row per input, as the record of who set what and when, audited as before. Beside it, `ops_settings_snapshot` (migration 0051) holds one row: a JSON object of every input's value. Three triggers on `ops_settings` rewrite it from the rows in the same transaction as any insert, update or delete, so no write — the console's, a script's or one by hand — leaves the two apart. The request path reads the snapshot row alone: one row a cache miss, whatever the register's length. A snapshot that has gone missing is built again from the rows on the first read that finds it gone.

ADR 0061's three safe defaults stand: a store that cannot be read gives the last good read or the committed defaults; a figure the register would no longer accept, in a row or in the snapshot, is ignored for its committed default; the console holds every draft as text.

**What it costs.** The free plan stops the day at 100,000 requests, and a request reads the store at most once, so the ceiling is 100,000 rows a day however the cache behaves: a fiftieth of D1's 5,000,000. The register's length now costs the snapshot's size, which every miss parses; `MAX_SNAPSHOT_BYTES` (16 KiB) bounds it with every input at its widest, and `test/node/ops-settings.test.ts` fails past it.
