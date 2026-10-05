# 0102. The window times in the console

- Status: accepted, on the owner's rulings of 30 September and 1 October 2026 (ADR 0025, item 74; `docs/open-points.md`, item 158)
- Date: 2026-10-01
- Amends [0035](0035-window-slot-map.md), whose times were constants; [0088](0088-every-policy-in-the-console.md), which kept them in code

## Context

A day is eight half-slots, and the client books one of three windows, each the half-slots `WINDOW_SLOT_MAP` gives it (ADR 0035). The half-slots' start times and the windows' hours were constants, printed at build on the site, the app and the console. ADR 0088 kept them in code: a window moved without its half-slots would put a booked visit in another window, and the hours printed at build would go on promising the old ones (ADR 0025, item 74).

The owner ruled on 30 September 2026 that the window times become a console setting, every surface reads the hours from the API, and which half-slots each window has stays in code. Asked one at a time on 1 October 2026, the owner chose how a change takes effect: only after the furthest day a client can book and after the last visit already booked, so nothing booked or bookable moves. The site reads the hours from the API, and each service's length too.

A held booking keeps its half-slot's place in the day (`slot_holds.start_unit`), and its time is worked out from that place whenever it is read. A visit's window is worked out from its time, against the windows' hours. So a change of times on a day already booked would move its visits, and a change read against the wrong day would put a visit in another window.

## Decision

**What ops set.** The eight half-slot starts and the day's end, in India's time. The windows are read from them: the morning from its first half-slot's start to the afternoon's, the afternoon to the evening's, the evening to the day's end (`windowTimesOf`, `src/policy/slot-times.ts`). The starts must be in order, the day's end after them, all between 06:00 and 22:00.

**From a day, never before one that is booked or bookable.** A change applies from a day after the last a client can book in the app (today and the `horizon` setting, 45 days now), after the last visit booked or held, and after any change before it (`earliestAppliesFrom`). The write itself checks again that no change and no visit or hold is on or after its day, so two members of staff saving at once, or a visit booked in FSM meanwhile, cannot slip under it.

**Changes are kept for good.** `slot_times` (migration 0067) holds each change, its day, its times, who set it and when, and triggers refuse any update or delete. A day takes the change with the latest day on or before it, else the times in code (`src/config/scheduling.ts`, now the defaults). To undo one, ops set the old times again from a later day. Each change is audited in the same batch.

**Every read of a day's times is by that day.** `loadSlotSchedule` reads the table once per request or run, and `schedule.on(date)` and `schedule.at(instant)` give a day's times and where an instant falls by them. They are used by:

- a hold's start (`visitTimes`, `heldVisitTimes`);
- the clash check's half-slots and windows (`occupancy`);
- the dispatch board and a move;
- a visit's window in the client app, on the technician's card and in the next visit offered;
- the window a change's 24 hours count back from;
- the hours in a visit's WhatsApp message.

**The API says the hours.** Each window the app is offered carries its hours that day (`/api/availability`). Ops read and set the times at `GET` and `POST /api/slot-times`. The CRM's `Booked_Window` pick-list names the window alone ("Afternoon"), since a pick-list's values are fixed in the org and cannot follow a setting.

**Owed: the surfaces.** The console's Settings section for the times, and the site, the app and the console reading every hour, and the site each service's length, from the API rather than at build. Until they do, they print the hours in code. No change can apply sooner than the furthest bookable day, 46 days out with the horizon at 45, so the surfaces are built before any change takes effect.

## Consequences

- Ops can change the day's times without a release, from a day well ahead. A client never sees a visit move under them.
- Changes accumulate. The table is read whole, so a change or two a year costs nothing.
- Tests: `test/node/policy/policy-slot-times.test.ts`, `test/worker/booking/slot-times.test.ts` and `test/worker/ops/ops-slot-times.test.ts`. The booking, dispatch, message and window tests now read the day's times.
