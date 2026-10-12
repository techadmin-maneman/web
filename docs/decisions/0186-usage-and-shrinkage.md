# 0186. Usage against expected, and shrinkage

- Status: accepted
- Date: 2026-10-12
- Topic: Field work

## Context

The scope: every job already records what a service is expected to use and what was used. A technician who runs consistently above expected is flagged, as is a kit that keeps needing write-offs. The views name count accuracy, write-offs and shrinkage.

## Decision

1. **A new Operations page, Usage, looks back 28 days.** It reads with Operations MANAGE in the caller's places, since it values stock at cost, as purchase orders do.
2. **Against expected:** each technician's done visits, each by its service and tier's expected use (ADR 0087), beside the consumables their kit used. Hair systems are left out: a fit takes one piece, which the piece step names. The overall figure is valued at each item's cost so items of different units add up, and each item is shown in its own unit.
3. **A technician is flagged** at more than 20% over expected across at least five visits.
4. **Losses:** for each place, what left it (used, sent on, counted short, written off) at cost; what of that was lost (counted short or written off); shrinkage as lost over left; write-offs; and, from cycle counts (ADR 0185), the share of lines counted right the first time.
5. **A kit is flagged** with three write-offs or more in the window.
6. **Flags show on the page only;** they tell no one, and are read on demand, never by the cron.

## Consequences

- A visit's use counts by the day it was recorded, and its expected use by the day it was booked for, so the two can straddle the window's start.
- Tests: `test/node/policy/stock-usage.test.ts`, `test/worker/ops/stock-usage.test.ts`, `test/dom/ops-usage.test.ts`, `e2e/ops/usage.e2e.ts`.
