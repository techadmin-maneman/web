# Booking, as it works now

How a visit comes to be on the calendar, and how it moves. One page for today's rules; the decisions behind them are linked at the end for the why.

## The day and its windows

A working day is eight half-slots. A client books one of three windows; the dispatch board shows four slots a day. A replacement takes a slot and a half, which is why the day is counted in halves (`src/config/scheduling.ts`). Which half-slots a window covers is code; what each half-slot means on the clock is ops' (`slot_times`, `src/domain/booking/slot-times.ts`), from a day, so a change never moves a visit already booked.

Days ops close are never offered: everywhere (`visit_blackouts`) or in one city for a local holiday (`city_blackouts`), both set in Settings · Blackouts (`src/domain/dispatch/blackouts.ts`).

## Who can take a visit

A visit goes to a technician in the client's city (`src/domain/dispatch/technician-fit.ts`); a first fit only to one trained to fit. Each technician takes visits within a radius of home in straight-line km, their own or Settings' (`src/policy/reach.ts`), and in an overflow ring past it at a cost; beyond the ring, never. A technician never takes two of a client's visits in a row unless nobody else can (`src/policy/technician-rotation.ts`). Among those free, whoever's home is known goes before any technician with no home pin, then whoever the visit costs least: the driving it adds, home again after the day's last visit included, with going into the ring, a fit's piece not in their kit, and a fuller week counted as minutes of driving, each figure under Settings › "Who takes a visit" (`src/policy/allotment.ts`, `src/domain/booking/start-offers.ts`). Leave is read with everything else a day holds, so a job on a day off is refused (`src/domain/booking/occupancy.ts`, `src/domain/dispatch/leave.ts`).

Who takes a visit is a draft until the evening before (ADR 0290): booking only proves the time fits someone's day. A time nobody can take is still offered where one technician's draft can go to another who may take it at its promised time, and holding it moves that draft, nobody told (`src/domain/booking/make-room.ts`, ADR 0292); never for a client's own move, and never a draft the evening's check or lock already holds. Each hour one day of the week ahead has its drafts re-planned to cost least, keeping every promised time (`src/domain/booking/replan-day.ts`); in the half hour before the reminder hour, tomorrow is re-planned and each drive is checked on the traffic Google expects when it sets off, a city at a time; at the hour the day is fixed, just before the reminder names the technician (`src/domain/booking/allotment-lock.ts`, `src/domain/booking/evening-check.ts`). Until then the client is told the technician is confirmed the day before, and the technician's phone lists the day's jobs as still to come. A technician ops choose when booking in the console is fixed at once.

Clients are steered to the times that drive least (ADR 0293): in the app and on the site, a start that adds more driving to its technician's day than the day's best start does, by more than Settings › "Times offered to clients" allows, is not offered, unless it is the day's last, and the app marks the day's cheapest few Recommended (`src/policy/steering.ts`); a client's hold takes only a start they are offered. Ops in the console see and may book every start.

Wherever a visit is booked, on the site, in the app or in the console, the starts offered rest on the free drive estimate, leaving out any Google's kept drive leaves no room for; before a start is held, Google checks the drives either side of it (`src/domain/booking/drive-check.ts`, ADR 0287).

Drive times are learned from our own drives (ADR 0294). Each night, every technician's drive from one job's close to their check-in at the next that day is set against what the estimate gives between the two addresses, and each city's drives are grouped by weekday or weekend and the hour they set off in; a drive over three times its estimate, or one over the break that took the break's length more, is left out (`src/policy/learned-drives.ts`, `src/domain/booking/learn-drives.ts`). Once an hour's group has the drives Settings › "Learning drive times" asks for, 20 until ops change it, its middle drive's per cent of the estimate paces that hour's drives wherever booking, the re-plan and the lock plan a day, and in the technician's leave-by times; until then the estimate stands. Under "Drive times", ops may use the estimate alone. Reports › Driving sets each technician's and city's drives as planned at today's pace against the minutes they took, by day or week, with every city's learned hours beside.

## Booking from the site

`/book` asks for the name and number first, kept as a lead before the visit is chosen (`src/domain/booking/public-lead.ts`). Then the window and the full address, and it books a free consultation, or a consultation and fit in one visit (`src/domain/booking/public-consultation.ts`). Where we do not come yet, it joins the waitlist (`src/domain/booking/public-waitlist.ts`). A friend's invite at `/r/:code` books the same way. Every booking first proves the number with a WhatsApp code, then signs the client into the app where it is on (ADR 0285); the waitlist asks none. Whoever types a number cannot move where that person's visits go (`src/policy/site-booking.ts`); a number we know that books nothing (a consultation still to come, a client who books in the app, an address we do not come to) is told why on the page and on WhatsApp (`src/domain/booking/site-notices.ts`).

## Booking in the app

The client holds a window while they pay; the hold keeps the time for the minutes `payment_hold` gives (Settings · Rules), and two holds never take the same time (`src/domain/booking/hold-slot.ts`). Razorpay's payment, or the request for a free visit, books it in one batch (`src/domain/booking/bookings.ts`). A paid hold whose request failed is booked by the half-hour pass (`src/domain/booking/unbooked-holds.ts`); one that cannot be kept is let go and refunded once (`src/domain/booking/give-back.ts`).

The app offers the next visit: the first fit once the consultation is done, then each service as it falls due (`src/policy/next-visit.ts`). Nothing books a visit for the client; ops step in on the Tasks board when a client lets one slide.

## Booking from the console

Ops book any kind of visit for a client they are talking to, found by the same availability and clash check (`src/domain/booking/visit-booking.ts`). A visit nothing is paid for at booking is booked at once; a paid one holds its slot while a Razorpay payment link is open, and is booked once paid (`src/policy/pay-by-link.ts`). What a client is owed again for free, a remake, is booked from its Tasks row with nothing to pay (`src/domain/booking/remakes.ts`).

## Moving and cancelling

A client moves or cancels in the app; what a late change costs is in Settings · Rules (`change_notice_hours`, `late_change_charge`) and `src/policy/moving-a-visit.ts`. Ops move a visit on the dispatch board (`src/domain/dispatch/dispatch.ts`); a move to another day waits for the client to accept it (`src/domain/dispatch/move-proposals.ts`). A client not home is a no-show case a person rules on (`src/policy/no-show.ts`, `src/domain/no-shows/no-shows.ts`).

## What ops change, and where

| What                                                               | Where                                |
| ------------------------------------------------------------------ | ------------------------------------ |
| Services, their names, lengths and order                           | Prices (`services`)                  |
| Window times                                                       | none yet: a migration (`slot_times`) |
| Closed days                                                        | Settings · Blackouts                 |
| Hold length, booking days, payment links, change and no-show rules | Settings · Rules                     |
| The service area                                                   | Areas (`serviceable_pincodes`)       |

## Decisions still worth reading

- [0034, the clash check](../decisions/0034-clash-check.md) and [0035, the window-slot map](../decisions/0035-window-slot-map.md): why the day is counted in halves.
- [0068, a paid hold is kept](../decisions/0068-a-paid-hold-is-kept.md): why a payment always ends booked or refunded.
- [0086, the next visit is offered](../decisions/0086-the-next-visit-is-offered.md): why the app, not ops, books the next visit.
- [0111, never two in a row](../decisions/0111-a-technician-never-takes-two-visits-in-a-row.md) and [0117, own city](../decisions/0117-a-technician-takes-visits-in-their-own-city.md).
- [0289, who takes a visit](../decisions/0289-who-takes-a-visit.md): the radius in km, the overflow ring, and the least cost.
- [0290, fixed the evening before](../decisions/0290-allotted-the-evening-before.md): drafts, the hourly re-plan, and the evening's check and lock.
- [0292, room made at booking](../decisions/0292-room-made-at-booking.md): a time freed by moving one draft.
- [0293, steering booking times](../decisions/0293-steering-booking-times.md): the cheapest times marked, the costliest not offered to clients.
