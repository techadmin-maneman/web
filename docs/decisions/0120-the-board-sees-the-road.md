# 0120. The board sees the road

- Status: accepted
- Date: 2026-10-11
- Topic: The ops console

## Context

The dispatch board was a week grid by technician (audit finding OPS-03). Nothing showed how far apart a technician's visits were, whether one could be reached in the gap the board left, or which technician was nearest when ops moved a visit. The owner ruled on 11 October 2026 to build it, and to switch on the Google APIs it needs.

## Decision

1. **A day's routes**, from each column's head: a map of every technician's day in their colour, their visits numbered in order, and beneath it each one's visits with the drive between each two. A drive longer than the gap between the end of one visit's time on the board and the start of the next is called out (`GET /api/dispatch/day`, `GET /api/dispatch/day/map`).
2. **A visit is where its client's address is pinned**, the coordinate the check-in's geofence measures against. A visit without one is listed with no drive to or from it.
3. **Drives come from Google's Routes API, the map from its Maps Static API**, through mm-api: the console never holds the key. One call per technician's day, without traffic and with at most ten stops between its ends, so each stays on Compute Routes Essentials (70,000 a month free on the India price list, as is Static Maps). A drive is kept a day and a map 15 minutes, and daily ceilings of 1,000 drives and 300 maps keep a month far inside the free allowance (`src/policy/rate-limits.ts`).
4. **Nearest first when moving.** The room route gives each technician's day the km, as the crow flies, from the job to their nearest other visit that day, and the move bar's list puts the nearest first. A straight line costs no call.
5. `ROUTES_PROVIDER` is `none` until the owner switches the two APIs on for the key (`docs/provisioning.md` section 13a); the board then shows the visits with no drive times and no map.

## Consequences

- Kept drives and maps live in Cloudflare's cache, not the database, and expire on their own: nothing new holds a client's coordinates.
- Tests: `test/worker/ops/dispatch-day.test.ts`, `test/node/api/google-routes.test.ts`, `e2e/ops/dispatch-day.e2e.ts`.
