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
   `DayColumn`, from 8 am to 8 pm at a pixel a minute, widened to the whole hours around any job outside them. It is a
   table of five-minute rows, as `DayTimeline` is one of half hours, so no block is placed by an inline style; a job
   lying wholly inside another is listed in that one's cell. A drive is hatched before its job, with when to leave, and
   today has a line in the brand's metal at the minute it is now. A job today, or a later one whose card has opened,
   opens its card, whose way back is then Schedule. A later job still locked opens a read-only preview: its time and
   length, area and payment, and when the client's name and address come, by the hour ops set for it. Today's "Tomorrow"
   row opens Schedule on tomorrow. With no signal, the days the phone keeps show and the rest say so, and the week is
   read again when signal returns, as Today is.
2. **Kit** gains "Next 7 days". `GET /api/tech/kit` carries `forecast`: each consumable the technician's visits booked
   from today to six days on are expected to use, by the job sheet, against what the kit holds fit to use: each held
   item carries `usable`, its count less its expired lots, which In kit, the forecast and an ask all read. A shortfall
   shows in red.
   Hair systems are left to the evening's check, as the week's top-up leaves them (ADR 0181). The rest of the screen is
   redrawn in the new look in the prototype's order: Arriving, Return to ops, In kit. An expired lot is listed under
   Return to ops, not as held.
3. **Me** names the technician's grade, city and number (`GET /api/tech/me`). "Technician" stands for one with no grade.
   It shows their quality over the last 30 days (`GET /api/tech/quality`, `src/policy/quality.ts`): the hairline redo
   rate, their first fits done or left partly done, and of them those whose free refit was booked within 30 days (ADR
   0192), a no-show or a fit closed "Can't fit today" being no fit; and on time, visits checked in by the booked
   start. There is no client rating until ratings exist. This month's incentives sit on Me itself, a line a kind of visit
   with its count and rate, and the total. The separate month screen is gone. Leave is redrawn in the new look, reached
   from Me.
4. **A technician's asks of ops** (owner's yes, 11 November 2026). Two tables, `kit_requests` and `reschedule_requests`
   (migration 0208), each with one ask open at a time. "Request what's short" under Next 7 days asks for what the week
   ahead finds short; the API works the amounts out rather than taking them from the phone, and keeps them as they were
   when asked. "Ask ops to reschedule" on the job takes why: the client asked, running late, or a kit problem. Each goes
   straight, with signal, and the phone then says when it was asked until it is settled. Each is a task on the board,
   `kit_request` within the day and `reschedule_request` within four hours, which ops close with what was done; closing
   settles the ask. A visit moved, given to another technician, closed or called off settles its own ask by trigger.

## Departures, and what is owed

- **The week strip** is `DateStrip`'s squares, not an underlined row (item 1).
- **The day** widens past 8 am to 8 pm where a job lies outside them, since ops' booking hours may run wider.
- **A later job** opens its card once it has opened, as the plan has tomorrow's job, and a preview only while locked;
  the preview's line says when the card opens by the hour ops set, rather than "6 pm the day before".
- **"How this visit is done"** on the preview waits for the guides, in PR 10.
- **Contact ops' hours** wait for an ops setting that holds them. No hours are written into the app.
- **The reschedule sheet** leaves out the prototype's "Free for the client until 24 h before the visit.": a fee rule
  is an ops setting, and none holds it yet.

## Consequences

- `DayColumn` is in the package for any day drawn down the hours.
- A job's card goes back to where it was opened from, noted as pages are shown (`apps/tech/src/lib/opened-from.ts`).
