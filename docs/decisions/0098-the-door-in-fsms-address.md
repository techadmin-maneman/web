# 0098. The door in FSM's service address

- Status: superseded by [0110](0110-field-work-without-fsm.md) on 4 October 2026: the door is kept on our own address record; FSM's address is not written. Was: accepted, on the owner's rulings of 27 September 2026 (`docs/open-points.md`, items 45 and 150) and 1 October 2026 (ops' form too)
- Date: 2026-10-01
- Amends [0054](0054-address-capture.md) and [0081](0081-the-site-takes-the-address.md), whose flat was optional; the lengths and characters FSM keeps are the trial of 30 September 2026 (`docs/archive/fsm-trial.md`, "Text FSM keeps")

## Context

The app, the site's form and ops' form ask for the flat or house number, the floor, the tower or block and a landmark beside the building, the street and the area (ADR 0054). Only the building, the street and the area reached FSM: `streetOf` wrote the first line as `Street_1` and the street and area as `Street_2`, so a work order in FSM named the society but not the door. The technician's app reads the whole address from our API, but ops and anyone reading FSM did not see it (open point 150).

The owner ruled on 27 September 2026 that the flat or house number is required in the site's form and the app, and reaches FSM's service address. On 1 October 2026 the owner ruled the same for ops' form, where a client gives their address on the phone.

## Decision

**Every address given from now on carries the flat or house number.** The app's save, ops' save and the site's two booking forms refuse one without it: `400 invalid_request` naming `flat` (`address.flat` on the site's forms), from one schema (`RequiredFlatSchema`, `src/routes/client/profile.ts`). Each form marks the field as required, names it when it is left out and gives it the focus, as the other required parts do. An address saved before holds none and still reads, and still reaches FSM as it did.

**FSM's two street lines hold the whole address** (`streetOf`, `src/domain/profile.ts`):

- `Street_1` is the door: the flat, the floor, the tower and the building or street, in that order, as "Flat 402, Floor 4, Tower C, Palm Grove Society".
- `Street_2` is the way to it: the second line, the area and the landmark, as "Golf Course Road, Sector 65, Landmark: Opposite the park".

The floor, tower and landmark are named, unless the client already wrote the name ("4th floor", "Block C" and "Landmark: the park" stand as typed). A part not given is left out.

**Each line is kept to what FSM takes** (`fsmText`, `src/lib/fsm-text.ts`). FSM refuses a street over 255 characters, and keeps text only up to its first character past U+FFFF, answering success either way. Such characters, mostly emoji, are left out, so the rest reaches FSM; a line still too long ends in "…". The door's line cannot reach 255 at the longest each part may be (238), so only the way to it is ever cut, at its landmark's end.

## Consequences

- A work order in FSM names the flat, floor and tower, and a new client's first booking cannot fail on a street FSM refuses.
- An old client, such as an app left open since before this change, that saves an address without the flat is refused, and the form says it could not save; saved again from the current app, it goes through.
- The labels "Floor", "Tower" and "Landmark:" are ours, in FSM only; no client sees them.
- Tests: `test/node/fsm-street.test.ts`; additions to the client-profile, consultations, referrals and ops-client-address tests and to `test/node/site/site-booking.test.ts`; the app's, the site's and the console's address specs.
