# 0290. A visit's technician is fixed the evening before

- Status: accepted
- Date: 2026-11-22
- Topic: Booking and visits
- Amends [0210](0210-booking-by-start-time.md) and [0289](0289-who-takes-a-visit.md)

## Context

The owner asked on 22 November 2026 why a technician is assigned when the visit is booked: booking need only make
sure the visit is not overbooked, and who goes can be settled the evening before. The best field-service businesses do
this. A booking still has to prove its time fits some technician's day with the drives either side, so it places the
visit on a technician's day, but that placing is only a proof until the evening before, which the engine may change to
cut driving. The owner chose the reminder hour (6 pm until ops change it) as the moment it is fixed.

## Decision

1. **A visit is booked with a draft technician** (`appointments.technician_draft`), unless it is for today, or for
   tomorrow once the reminder hour has come in its city, or ops chose the technician when booking it in the console
   (`slot_holds.technician_chosen`), when it is fixed at once. Every visit booked before this keeps its technician.
2. **The lock fixes tomorrow's drafts at the reminder hour**, in the same pass and just before the reminders that name
   the technician (`src/domain/booking/allotment-lock.ts`, `src/scheduled/cron.ts`). The technician's card already
   opens at that hour.
3. **Until then nobody is told who.** The client's visits and the hold leave the technician out, and the app says
   "Confirmed the day before", as its reminder comes the day before; a booking's messages say "our technician"; the
   technician's app does not list a draft, and says a day's jobs come the evening before rather than that nothing is
   booked. Ops see the draft's technician, marked as a draft, on the board and in the console's booking.
   A draft's changes do not reach the technician's alerts (migration 0230).
4. **A visit ops place by hand is fixed** where they place it; one a client moves past its day's lock is a draft
   again. The board's drawer says when a visit's technician is a draft.
5. **Drafts are re-planned to cost least** (`src/policy/replan.ts`, `src/domain/booking/replan-day.ts`): each keeps
   its promised time, and moves to another technician, or swaps with another draft, wherever that costs less in all
   (ADR 0289's cost, summed over the city's day) and still fits both days. Nobody who may not take it gets it. The
   moves are written in one batch under the claims a move takes (ADR 0069), so a hold on the same time since fails
   the batch, and nobody is told. The night re-plans the week ahead at 2 am.
6. **Tomorrow is checked on Google before it is fixed** (`src/domain/booking/evening-check.ts`). At the reminder
   hour, each city is re-planned on the estimate, and each drive on each technician's day is asked of Google on the
   traffic expected when it sets off: once the visit before is wrapped up, or, for the day's first, from home as late
   as the estimate lets it. A drive with too little room rules its technician out of the draft at either end before
   one more re-plan. What still falls short is fixed as it stands, so the reminders still go, and ops are alerted to
   the drive (leg_short), to shift a visit or call the client. Where the routes provider is off, the estimate stands.
   Asking for traffic bills as Compute Routes Pro rather than Essentials, one call a drive; at a few technicians a
   city that is tens of calls an evening, inside the daily route ceiling the board and booking share.

## Consequences

- The client learns the name in the evening's reminder, as before for a visit booked well ahead.
- The booking that moves a draft to make room for a time nobody could otherwise take comes in its own change.
