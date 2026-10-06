# 0111. A technician never takes two visits in a row

- Status: accepted, on the owner's ruling of 5 October 2026
- Date: 2026-10-05

## Decided

The owner asked that "the same technician is not assigned to a customer twice in a row", and that the copy claiming otherwise go.

Booking used to put the client's "regular technician" first: whoever did their latest completed visit (ADR 0045). The app said so on the window step ("Imran, your regular technician, is free"). That preference is gone, and the opposite is a rule.

## Built

- **The rule** (`src/domain/booking/technician-rotation.ts`): a technician may not take a client's visit if they took that client's latest visit before its day, have the client's first visit after it, or have one of the client's visits on that day. A visit counts unless it is cancelled; a no-show counts, since a technician went to the door. A booking paid for and not yet a visit counts as its visit.
- **Everywhere a technician is put on a visit:** the windows the app and ops offer, the hold that books one (app, site and ops), and the dispatch board's moves and the rooms it offers. A move refused for it answers `back_to_back`. A move that keeps its technician and day puts nobody new beside the client and is not checked. A visit being moved or replaced does not stand beside itself.
- **Among the rest,** whoever holds the least that day takes the hold, then whoever holds the least over the week around it.
- **What the client sees:** each window is open or full (`open` on `GET /api/availability`); who will come is never promised before the hold names them. The `regular` field and the window step's "regular technician" lines are removed.
- **The site's form** answers a number we know as it would a new one, worked out for nobody in particular, so the rule cannot make the form say whose number it is (PS-06).

## Consequences

- With few technicians in a city, a client's windows are fewer: the technician of their last visit is never offered.
- Ops cannot override it on the board. A visit that must go back to the same technician waits for the owner to ask for an override.
