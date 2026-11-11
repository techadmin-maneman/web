# 0249. Schedule, Kit and Me

- Status: accepted
- Date: 2026-11-11
- Topic: Field work
- Builds on [0164](0164-the-kit-screen.md), whose kit it redraws, and [0239](0239-technician-light-look.md), whose look it
  takes to three more tabs

## Context

PR 9 of the technician redesign (`docs/technician-redesign/PLAN.md`) covers Schedule and its preview, Kit with its
forecast and a request to ops, Me with quality, incentives, leave and contact, and asking ops to reschedule. The backend
gaps it closes are 7, 10, 11 and 15 of the plan. The brief (`docs/prompts/tech-redesign.md`, "Schedule", "Kit", "Me")
and the prototype say how each looks. The owner's rules hold: every part comes from `packages/ui`, no inline style, and
every business rule is an ops setting.

## Decision

1. **Schedule** is today and the six days after it. The strip is the shared `DateStrip`, each day with its count of jobs,
   rather than the prototype's underlined row: one strip of days, one look. The day chosen is drawn by a new shared part,
   `DayColumn`, from 8 am to 8 pm at a pixel a minute. It is a table of five-minute rows, as `DayTimeline` is one of half
   hours, so no block is placed by an inline style. A drive is hatched before its job, with when to leave, and today has a
   line in the brand's metal at the minute it is now. A job today opens its card, whose way back is then Schedule. A later
   job opens a read-only preview: its time and length, area and payment, and that the client's name and address come at
   6 pm the day before. Today's "Tomorrow" row opens Schedule on tomorrow.
2. **Kit** gains "Next 7 days". `GET /api/tech/kit` carries `forecast`: each consumable the technician's visits booked
   from today to six days on are expected to use, by the job sheet, against what the kit holds. A shortfall shows in red.
   Hair systems are left to the evening's check, as the week's top-up leaves them (ADR 0181). The rest of the screen is
   redrawn in the new look in the prototype's order: Arriving, Return to ops, In kit. An expired lot is listed under
   Return to ops, not as held.
3. **Me** names the technician's grade, city and number (`GET /api/tech/me`). "Technician" stands for one with no grade.
   It shows their quality over the last 30 days (`GET /api/tech/quality`): the hairline redo rate, first fits followed by
   another first fit for the same client within 30 days, whoever fits it; and on time, visits checked in by the booked
   start. There is no client rating until ratings exist. This month's incentives sit on Me itself, a line a kind of visit
   with its count and rate, and the total. The separate month screen is gone. Leave is redrawn in the new look, reached
   from Me.

## Departures, and what is owed

- **The week strip** is `DateStrip`'s squares, not an underlined row (item 1).
- **"How this visit is done"** on the preview waits for the guides, in PR 10.
- **Contact ops' hours** wait for an ops setting that holds them. No hours are written into the app.
- **Request to ops and reschedule** need two tables, `kit_requests` and `reschedule_requests`. They wait for the owner's
  yes on that schema change, asked on 11 November 2026.

## Consequences

- `DayColumn` is in the package for any day drawn down the hours.
- A job's card goes back to where it was opened from, noted as pages are shown (`apps/tech/src/lib/opened-from.ts`).
