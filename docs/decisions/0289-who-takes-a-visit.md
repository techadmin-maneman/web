# 0289. Who takes a visit: a radius in km, an overflow ring, and the least cost

- Status: accepted
- Date: 2026-11-22
- Topic: Booking and visits
- Amends [0210](0210-booking-by-start-time.md) and [0223](0223-reach-from-home.md)

## Context

The owner asked on 22 November 2026 whether visits go to technicians the way the best field-service businesses send
them: within a radius of home that ops set, with as little driving as possible. They did not. A start went to whoever it
added the least driving to; a reach was a hard limit in minutes of driving from home; for a fit, only the technicians
whose kit held the piece were offered at all; the drive home after the day's last visit was not counted; and a
technician with no home pin drove nothing to their first visit and passed every reach, so won ties they should not.

The owner's rulings, asked one at a time: a radius in straight-line km; past it an overflow ring, then nothing; a fit
whose spec is known strongly prefers the technician whose kit holds its piece; technicians are paid a salary and a
per-visit incentive, so driving comes first and work is evened out over the week. This record is the first of four
steps; the next allots technicians the evening before the visit, at the reminder hour.

## Decision

1. **A radius from home, in straight-line km.** Each technician has one: their own, set on their Hours tab, or the
   business's from Settings ("Technician radius", 10 km, what 45 minutes covered). Migration 0228 turns each own reach
   into the km it covered.
2. **An overflow ring past it.** A technician takes a visit in the ring, out to a percentage of their radius (150%
   until ops change it), only where it costs least; beyond the ring, they are not offered it. A technician with no home
   pin is still offered visits, so a city whose pins are not set yet still books, but goes after every technician whose
   home is known and who can take that start: nobody can tell how far they would drive. The plan the owner approved
   said a technician with no home pin is offered nothing; this departure awaits the owner's ruling. A move stays with
   its technician, and ops may still place any visit by hand.
3. **The least cost goes.** Of those who can take a start, the one it costs least, in minutes: the driving it adds,
   now with the drive home after the day's last visit; going into the ring; for a fit whose spec is known, a piece in
   the city's stockroom or nowhere in it; and each hour more booked that week than the least booked of them. Ties go
   to whoever has less booked that day, then that week. Every figure is under Settings › "Who takes a visit".
4. **Every trained fitter is offered a fit.** Where their piece is counts in the cost, not in who is offered; the
   evening's kit check still tells ops what to move. A consultation and fit in one visit has no spec until it is
   measured, so no piece counts.
5. **Areas measures in km.** The map draws each radius; a served pincode no ring takes in is out of every reach.

## Consequences

- A technician with no home pin now goes after anyone whose home is known; staging's Noida and Mumbai technicians and
  one in Gurgaon have none, and take visits as before where nobody else can, until ops set them.
- More starts are offered for a fit, since a kit that holds the piece no longer narrows who may take it.
