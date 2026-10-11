# 0117. A technician takes visits in their own city

- Status: accepted
- Date: 2026-10-11
- Topic: Booking and visits
- Amends [0034](0034-clash-check.md): who can take a visit is narrowed by place before the clash check runs

## Context

A window was offered to a client, and a hold given to a technician, wherever any active technician had room. Where a technician worked played no part: a Mumbai technician's free morning showed as open to a Gurgaon client, and the booking could land on them. The dispatch board let ops hand a visit to anyone too. `technicians.city`, which ops set on the Technicians screen, placed a technician for staff access alone (ADR 0109).

## Decision

The owner's rulings, 11 October 2026:

1. **Same city only.** A visit goes only to a technician whose city is the visit's: the city of the pincode it is booked at, else of the client's current address. NCR's cities are not pooled.
2. **No city, no bookings.** A technician with no city is offered no visit until ops set one; the Technicians screen says so on their row and in their details.
3. **The board keeps to it.** Handing a visit to another technician is refused, `other_city`, where that technician works in another city or in none, and the board offers no room with them. A visit keeps its own technician through a change of time, and one whose city is not known can still go to anyone.

The technicians who may take a visit are read in the same statement as before, so a booking waits on no more round trips.

## Consequences

- Staging's active technicians had no city when this landed: until ops set one for each, staging offers no slot.
- A city with no technician of its own shows no slot at all.
- Tests: `test/worker/booking/technician-city.test.ts`, and the city cases in `test/worker/ops/dispatch-landing.test.ts`.
