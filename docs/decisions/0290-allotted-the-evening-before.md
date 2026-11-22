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
   tomorrow once the reminder hour has come in its city, when it is fixed at once. Every visit booked before this keeps
   its technician.
2. **The lock fixes tomorrow's drafts at the reminder hour**, in the same pass and just before the reminders that name
   the technician (`src/domain/booking/allotment-lock.ts`, `src/scheduled/cron.ts`). The technician's card already
   opens at that hour.
3. **Until then nobody is told who.** The client's visits and the hold leave the technician out, and the app says
   "Confirmed the evening before"; a booking's messages say "our technician"; the technician's app does not list a
   draft.
4. **A visit ops place by hand is fixed** where they place it.

## Consequences

- The client learns the name in the evening's reminder, as before for a visit booked well ahead.
- The re-plan that changes a draft's technician to cut driving, and the booking that moves a draft to make room, come
  in the next changes; until then a draft keeps the technician booking placed it with.
