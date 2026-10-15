# 0118. Booking never dead-ends

- Status: accepted
- Date: 2026-10-11
- Topic: Booking and visits
- Amends [0111](0111-a-technician-never-takes-two-visits-in-a-row.md): a repeat is allowed where nobody else in the city can take the visit
- Amends [0117](0117-a-technician-takes-visits-in-their-own-city.md): a client's move may go to anyone in their city

## Context

Once a visit went only to a technician in its own city (ADR 0117), three rules could leave a client with nothing to book, or the site promising what nobody could honour. A city with one technician could never book a client's next visit, since that technician had taken the last one (ADR 0111). A client's free move kept the visit's own technician, so their busy days showed no time at all while others in the city were free. And a pincode could be launched where no technician worked: its waitlist was told we come, and nothing could be booked.

## Decision

The owner's rulings, 11 October 2026:

1. **Never twice in a row, unless nobody else can.** A technician is not offered the client's visit just before or after their own, unless nobody else in the city has room in that window. The same holds for a hold, ops' booking, and a move on the dispatch board, where a visit staying where it is counts as room.
2. **A client's move goes to anyone in their city,** their own technician first where free. A move in place is booked with the technician it was held with. Ops moving the visit after the client chose their time still gives the move back (`takesHeldTime`).
3. **No launch without a technician.** Launching a pincode, from the waitlist or by serving it, is refused while no active technician works in its city (`no_technician`).

## Consequences

- A client may see the same technician twice in a row in a city with few technicians.
- Ops must place a technician in a city before its first pincode goes live.
- Tests: `test/worker/booking/client-booking-holds.test.ts`, `visit-changes-moving.test.ts`, `test/worker/dispatch/dispatch-landing.test.ts`, `ops-service-area.test.ts` and `test/worker/referrals/referral-cards-launch.test.ts`.
