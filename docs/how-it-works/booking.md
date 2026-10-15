# Booking, as it works now

How a visit comes to be on the calendar, and how it moves. One page for today's rules; the decisions behind them are linked at the end for the why.

## The day and its windows

A working day is eight half-slots. A client books one of three windows; the dispatch board shows four slots a day. A replacement takes a slot and a half, which is why the day is counted in halves (`src/config/scheduling.ts`). Which half-slots a window covers is code; what each half-slot means on the clock is ops' (`slot_times`, `src/domain/booking/slot-times.ts`), from a day, so a change never moves a visit already booked.

Days ops close are never offered: everywhere (`visit_blackouts`) or in one city for a local holiday (`city_blackouts`), both set in Settings · Blackouts (`src/domain/dispatch/blackouts.ts`).

## Who can take a visit

A visit goes to a technician in the client's city (`src/domain/dispatch/technician-fit.ts`); a first fit only to one trained to fit, with a hair system matched to the client. A technician never takes two of a client's visits in a row unless nobody else can (`src/policy/technician-rotation.ts`). Among those free, whoever holds least that day, then that week, takes it (`src/domain/booking/technician-choice.ts`). Leave is read with everything else a day holds, so a job on a day off is refused (`src/domain/booking/occupancy.ts`, `src/domain/dispatch/leave.ts`).

## Booking from the site

`/book` asks for the name and number first, kept as a lead before the visit is chosen (`src/domain/booking/public-lead.ts`). Then the window and the full address, and it books a free consultation, or a consultation and fit in one visit (`src/domain/booking/public-consultation.ts`). Where we do not come yet, it joins the waitlist (`src/domain/booking/public-waitlist.ts`). A friend's invite at `/r/:code` books the same way. Whoever types a number cannot move where that person's visits go or learn anything about them (`src/policy/site-booking.ts`); what the form needs to tell a known number goes privately on WhatsApp (`src/domain/booking/site-notices.ts`).

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
