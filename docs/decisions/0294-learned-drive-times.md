# 0294. Drive times are learned from our own drives

- Status: accepted
- Date: 2026-11-22
- Topic: Booking and visits
- Amends [0287](0287-a-start-googles-drive-refused-is-not-offered.md)

## Context

Every plan of a technician's day rests on the free drive estimate (`src/policy/drive-estimate.ts`): the straight line
between two pins, made longer by a road factor, at a peak or off-peak speed, with time to park. It knows nothing of a
city's roads or of the hour, beyond its two speeds, and Google is asked only where a start is held and the evening
before (ADR 0287, ADR 0290). The owner ruled on 22 November 2026 that drive times are learned from the drives our
technicians make: per city, weekday or weekend, and the hour a drive sets off; an hour uses what is learned of it,
automatically, once it has enough clean drives, ops' minimum, 20 at first; ops may turn learning off; the console shows
every learned time and its count. A clean drive is one between a technician's jobs that follow each other on a day,
leaving out one over three times its estimate, or one with a break or leave in it, and the middle drive is used. A
report in the console's Reports sets the drives planned against those taken, per technician and city, by day and week,
with the learned times beside.

## Decision

1. **A drive** (`src/policy/learned-drives.ts`) runs from one job's close, its last outcome standing, to the same
   technician's first check-in that passed at the next job of the day, against what the estimate gives between the
   addresses the two check-ins were made at, setting off in the hour of the close. A check-in passed only by ops'
   waiver, for a pin far from its door, is not an arrival learned from, as the estimate to that pin is wrong. A drive
   more than ops' spread from its estimate, either way, is left out: over three times it, as an errand, or under a third
   of it, as a job closed late, at the next door, until ops change it. The owner set the three times; the third is its
   mirror, so a late close cannot drag an hour down, and a factor is never under 1 per cent. Like every rule, the
   spread is a setting, not a figure in code (ADR 0193). So is the break: a drive that spans the break's window and
   took the break's length more than its estimate is left out, as a lunch, and so is one across the technician's
   leave.
2. **Each night**, from 2 am in India (`learn_drives`, `src/scheduled/allotment-jobs.ts`), every city's drives of the
   weeks before today, eight until ops change it, are grouped by weekday or weekend and hour; each group's middle drive,
   as a per cent of its estimate, is written with how many drives stand behind it (`drive_factors`, migration 0231). The
   table is written afresh each night, so a city with no drives in those weeks keeps nothing.
3. **The pace.** Where an hour's group has `min_drives` drives or more, a drive setting off in it takes that per cent
   of the estimate, never under the least drive; until then the estimate stands (`atPace`). Every day plan reads its
   technician's city's groups (`src/domain/booking/day-plans.ts`), so booking, the hourly re-plan and the evening's
   lock all plan at the pace, and so do the technician's leave-by and finish-by times (`src/policy/next-job.ts`).
   Google's checks measure the drive itself; the estimate they tell ops beside Google's drive, and the departure from
   home they ask Google about, are the paced ones (`src/domain/booking/drive-check.ts`,
   `src/domain/booking/evening-check.ts`).
4. **Ops set it** in Settings › Booking: "Drive times", learned where enough drives or the estimate only, and "Learning
   drive times", the drives before an hour is used (5 to 200), the weeks learned from (2 to 26), and the spread a drive
   is kept within (2 to 6 times the estimate, either way). With the estimate only, the nightly run still learns, and the
   report shows which hours have the drives to be used.
5. **Reports › Driving** (`GET /api/reports/driving`, `apps/ops/src/driving/`), for Operations' national View: over
   the last week, 4 or 8, by day or week, each city's and each technician's clean drives, the minutes booking plans for
   them at today's pace beside the minutes they took, and the gap; and every city's learned hours, each with its drives
   and whether it has the drives to be used.

## Consequences

- A city's plans grow truer as its technicians work, an hour at a time, with nothing to set by hand; a new city plans
  on the estimate until it has its own drives.
- The planned minutes of past drives are worked out at today's pace, not the pace they were booked at, which is not
  kept.
- A drive is learned only where both check-ins name their address; one checked in without it is left out.
- A drive runs from the job's outcome, its last step, while a plan keeps the wrap-up after a visit before its drive.
  Packing done after the outcome is counted in both, so a learned pace runs high by that time over the drive's
  estimate. The owner set the drive from the close; the report's gap shows it.
- Ops in a city or a zone do not see the report until it keeps to their places.
