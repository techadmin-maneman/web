# Field work, as it works now

What a technician does on a visit, and what it writes. Our own database is the record of field work; nothing waits on a vendor ([ADR 0110](../decisions/0110-field-work-without-fsm.md)).

## The technician's day

The technician app shows the day's jobs (`src/domain/field/tech-jobs.ts`). Until the evening before, a job shows only its time, kind and sector; from then the card holds the client, the address, their pieces, the last visit and the hair profile (`src/domain/field/job-card.ts`, `src/policy/job-visibility.ts`, the hour in Settings · Rules as `address_unlock_hour`).

A technician signs in with a WhatsApp code on the one phone ops allowed (`src/domain/dispatch/technicians.ts`). Ops add, move and switch off technicians on the Technicians page (`src/domain/dispatch/technician-roster.ts`).

## A visit, step by step

Each step the technician takes, arriving, starting, the checklist, the photographs, the piece, what was used, and the close, goes into the phone's outbox and lands on the server whenever there is signal (`src/domain/field/job-events.ts`). Each step writes our record of the visit in the same batch, and is safe to land twice, since a phone replays its outbox (`src/domain/field/job-record.ts`).

- **Arriving** is checked against the client's pin, within `checkin_radius_m`; the client is told on WhatsApp, if the check-in reaches us within `arrival_notice_min` of it.
- **The checklist** is each kind of visit's own, as ops set it in Settings · Job sheet, in the technician's words and the client's (`checklist_items`, `src/domain/field/job-sheet-settings.ts`).
- **Photographs**: a before set and an after set of the same five angles (`src/domain/field/visit-photos.ts`). No member of staff sees them unrecorded: opening them writes an audit entry first (`src/domain/field/photo-views.ts`).
- **The piece** fitted comes out of the technician's kit as the step lands (`src/domain/inventory/piece-use.ts`); one taken off at a replacement is held in the kit as returned until handed in (`src/domain/inventory/piece-returns.ts`).
- **What was used** of the consumables is taken from the kit (`src/domain/field/job-use.ts`).
- **The close** says how it ended: done, partly done with a reason (Settings · Job sheet), or a no-show after the wait (`no_show_wait_min`).

A visit left partly done waits on the Tasks board for its follow-up; a no-show is a case a person rules on (`src/domain/no-shows/no-shows.ts`).

## Dispatch

The dispatch board shows each technician's seven days, four slots each (`src/domain/dispatch/dispatch-board.ts`). Ops move a job on it with the same clash check booking uses (`src/domain/dispatch/dispatch.ts`); a move to another day waits for the client (`src/domain/dispatch/move-proposals.ts`). Where Google's routes are on, the board shows each day's drives and map (`src/domain/dispatch/day-route.ts`). A visit with no technician is a task the day before and an alert on its day (`src/domain/dispatch/unassigned.ts`).

## Pay

Each technician's month is every visit they closed, by kind and city, at the rate for their grade in force on the visit's day (`src/domain/field/pay-statement.ts`, `src/domain/field/technician-pay.ts`), set on the Technician pay page.

## Decisions still worth reading

- [0038, offline writes](../decisions/0038-offline-writes.md): why every step is safe to land twice.
- [0028, photographs from the app](../decisions/0028-photographs-from-the-app.md).
- [0087, consumables and stock](../decisions/0087-consumables-and-stock.md).
- [0122, technician pay per visit](../decisions/0122-technician-pay-per-visit.md).
