# 0223. Reach from home, drawn on the city's map and checked at the address

- Status: accepted
- Date: 2026-10-26
- Topic: Booking and visits
- Amends [0117](0117-a-technician-takes-visits-in-their-own-city.md) and [0210](0210-booking-by-start-time.md)

## Context

The pincode plan's third part, approved by the owner on 25 October 2026. A visit went to any active technician in its
city, however far across the city they lived, and coverage was a city-level guess: ops could not see which served
pincodes nobody really reached, nor pick a city's pincodes by who could go there.

## Decision

1. **Each technician has a reach:** minutes of driving from their home pin, their own where ops set one on their Hours
   tab, else the business's from Settings ("Technician reach", 45 minutes until ops change it). A reach is measured by
   the same drive estimate booking plans with (ADR 0210), at an hour between the rushes, so it is one figure all day.
2. **Booking offers a start only to technicians whose reach takes in the address.** Where the address has no pin, or a
   technician has no home pin, that technician stays in, as before reaches. A move keeps its technician, and ops may
   still give any visit to anyone from Dispatch.
3. **Areas draws each city's map:** its pincodes by state (served, not served, paused, and served but out of every
   reach) and each technician's home with the circle their reach covers, as a static map from the routes provider,
   kept a quarter of an hour, as the day map is. Beside it are the served pincodes no reach takes in, each with the
   nearest technician, and each technician's reach as a way to choose its pincodes, which the bar above then serves,
   schedules or pauses. Choosing by a reach stands in for drawing round pincodes on the map.

## Consequences

- A pincode no technician reaches is offered no start, and the site says so as it does for a day fully booked. The map
  and the list beneath it are where ops see it coming.
- A technician's home pin now decides what they are offered, so setting it matters before launch, as the readiness
  check already says (ADR 0221).
