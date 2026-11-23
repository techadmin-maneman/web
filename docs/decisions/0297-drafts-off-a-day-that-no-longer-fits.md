# 0297. A draft its day no longer fits is moved, and two cities are checked a run

- Status: accepted
- Date: 2026-11-23
- Topic: Booking and visits
- Amends [0290](0290-allotted-the-evening-before.md), decisions 5 and 6

## Context

ADR 0290's re-plan left a technician's day as it stood where it no longer fitted: leave laid over a draft, shorter
hours or a lower cap. Nothing moved off it or onto it, and a technician away all day was not re-planned at all, so the
evening's lock fixed the visit on a technician who could not do it, and nobody was told. The check before the lock took
one city every five minutes, so a seventh city sharing a lock hour was never checked, with nothing logged.

The owner ruled on 23 November 2026: move such a draft to another technician in the city, telling ops only when nobody
can take it; and check two cities a run, so every city is checked.

## Decision

1. **A draft whose own day no longer fits starts the re-plan with nobody** (`src/policy/replan.ts`). The plan places it
   wherever it fits and costs least, its own technician included where it still fits there, as with a cap that now
   leaves room for all but one of their drafts. A technician away all day is re-planned too: their drafts are read
   from what is booked on the day (`DayPlans.booked`), not from a day they no longer work.
2. **A draft nobody can take is told to Operations once** (`draft_stranded:<visit>:<date>`, `tellStranded` in
   `src/domain/booking/replan-day.ts`), by the hourly re-plan and by the check before the lock. It stays with its
   technician, and the lock fixes it there unless ops move it by hand.
3. **The check before the lock takes two cities a run where more than six share a lock hour** (`CHECKS_A_RUN`,
   `src/domain/booking/allotment-lock.ts`), one after the other, each with its own 60 drives and 20 seconds of Google,
   so twelve cities may share one. Six or fewer are still checked one a run, as the half hour has six runs: two cities'
   work in one run is about 220 statements, past the cron's 200 (`CRON_STATEMENTS_PER_RUN`).

## Consequences

- A day with leave laid over one draft keeps its other drafts where they still fit: only what no longer fits moves.
- Past six cities to a lock hour, a run of the check does two cities' work, past the cron's statement budget and
  within D1's 1,000 an invocation; a city checked second waits for the first, up to 20 seconds of Google.
- A thirteenth city sharing a lock hour would still go unchecked; at five cities served that is far off.
