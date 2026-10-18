# 0210. Booking by start time

- Status: accepted
- Date: 2026-10-18
- Topic: Booking and visits
- Supersedes [0035](0035-window-slot-map.md) and [0102](0102-window-times.md) once its engine lands; amends [0034](0034-clash-check.md) and [0062](0062-leave-on-the-dispatch-board.md)

## Context

A client books one of three windows: morning, afternoon or evening. Behind them the day is eight half-slots, and a visit holds as many as its length needs. Nothing counts how far apart two visits are, a technician's working hours, or when they can reach the first door. A client is promised four hours and the technician has no time to work to.

On 18 October 2026 the owner asked for starts every 30 minutes, as Urban Company offers them. Each start is to be tied to the technician's availability, the visit's length and the drive between visits. The owner approved the plan (https://claude.ai/artifact/H6KNyw4qqgPL7qGmxoMUNR) and ruled on its eight questions.

## Decision

1. **The client picks a start time** from a grid of starts `step` minutes apart (30 to begin with). The technician arrives within the `arrival` window after it (30 minutes). Who comes is not promised. A taken time is shown struck through.
2. **A start is offered only where someone can take it.** It must fall inside a technician's working hours in the visit's city, clear of their leave and the city's blackouts. The visit, plus a wrap-up after it, must fit between the visits before and after it, with the drive to it and from it. The day keeps a floating break. Two caps apply: visits a day, and fits a day. The rules a fit and a client's rotation already follow still hold (ADR 0111, ADR 0119).
3. **A technician's own week** (`technician_hours`): the days they work and the hours of each, on the quarter hour. A technician with none works their city's hours every day (`working_hours`, 9 am to 8 pm to begin with). Ops set each technician's weekly off on their week.
4. **A technician's home** is a place ops choose with the building search, geocoded once. The drive to their first visit is counted from it.
5. **Leave may cover part of one day**, between two times (`technician_leave.from_time`, `to_time`). The jobs it names are those its hours cover. Booking under the windows treats such a day as a whole day off until the engine reads times.
6. **Drives are estimated free for every start offered.** The straight line between the pins is lengthened by a road factor and driven at the city's speed for the hour it sets off in, slower in the morning and evening rush. Then come the minutes to park and reach the door, with a shortest drive (`drive_estimate`). Where the routes provider is on, Google's Route Matrix checks the drives on either side of the start a client chooses before it is held.
7. **A pin stands in until there is one.** A pincode's centre, placed hourly by `pincode_centres` and asked of Google once, stands in for a client's pin until their address has one.
8. **Same-day booking** from the lead time on (3 hours), by kind of visit (`same_day_booking`): never a fit, whose hair system is packed the evening before.
9. **Ops move a visit to a start** on the dispatch board, by the same plan of the technician's day. A window dropped on lands at its earliest start with room, and the move sheet offers its other starts. A change of technician alone keeps the visit's start. A time a visit already takes is a clash; no room for the drives or the wrap-up is `does_not_fit`. A proposal to the client keeps the start it offers (`move_proposals.starts_at`).
10. **Every city at once, before production launches.** No booking exists yet in either environment, so start times replace the windows outright, with no switch and nothing to carry over.

Every figure is an ops setting: `booking_rules`, `same_day_booking`, `working_hours` and `drive_estimate`, all national.

## Consequences

- Built in phases, one PR each: the technician's days, the drive estimate and the settings; the engine (holds and claims by start time, with a lock on the technician's day); the client app and site; the console's booking and the dispatch day; the technician app, the rules that measure from a start, and analytics; then a run on staging.
- The windows' half-slots, the window times page and `slot_times` go when the engine lands.
- On time comes to mean a check-in by the end of the arrival window, a stricter measure than before.
- A technician's home is their personal data, kept only for the drive. It is shown to Operations staff in their city, and goes when the technician is deleted.
- Tests: `test/node/policy/policy-start-times.test.ts`, `test/worker/dispatch/technician-days.test.ts`, `test/dom/ops-technician-hours.test.ts`, `test/node/dispatch/move-landing.test.ts`.
