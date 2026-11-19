# 0285. Every booking on the site asks the WhatsApp code, and signs the client in

- Status: accepted, on the owner's rulings of 19 November 2026
- Date: 2026-11-19
- Topic: The site
- Amends [0214](0214-from-the-site-into-the-app.md) and [0081](0081-the-site-takes-the-address.md) on which bookings ask the number's code, and [0068](0068-a-paid-hold-is-kept.md) on what a number we know is answered

## Context

Since 2 October a WhatsApp code proved the number for the consultation and fit in one visit only (0081, amended), and
a booking whose number was proved went on into the client app signed in (0214, decision 3). A free consultation asked
no code, so its client typed a code again in the app. And since whoever typed a number might not hold it, a number the
site already knew was answered as a new one would be (0068, amended 2 October): a day and calendar buttons for a visit
never made (QA finding A-011), the truth going only to WhatsApp.

The owner ruled, 19 November, that every booking on the site asks the code and, once it is entered, treats it as a
sign-in and shows the client the signed-in app; that the waitlist asks none; and, as production runs the site without
the client app, that the page itself tells a number we know why nothing was booked.

## Decision

1. **Every booking asks the code.** `POST /api/consultation` and `POST /api/r/{code}/consultation` refuse
   `403 number_not_proved` without a `number_code_id` that proved the number in the last 30 minutes, for the
   consultation alone as for the one visit, on the site's own page, an invite's and a partner's. Nothing is looked up
   or written for the number before.
2. **The form sends the code first.** Its button sends the code to the number, then reads "Confirm and book" until it
   is entered. A code the tab proved in the last 30 minutes, at the try-on or an earlier booking, is not asked again;
   once the API no longer takes it, the tab forgets it and the next press asks a new one.
3. **The booking signs the client in** as 0214's decision 3 does, now for every booking: where the client app is on,
   the page opens it signed in.
4. **The waitlist asks no code.** Nothing is booked, and nobody is signed in.
5. **A number we know is told why nothing was booked.** It is answered `not_booked` with its reason: a consultation
   still to come (restated by its day and hours), a client whose visits are booked in the app, or an address on the
   account where we do not come, with WhatsApp's button. No "Booked", no calendar. WhatsApp tells its owner as before.
   No hold is tried for it first, as one was to make its answer a new number's.
6. **The site's codes count by the address's day, 100, as its bookings do**, since a mobile network puts many people
   behind one address; the number's 5 a day and the day's ceiling still hold. The app's login codes keep 10 an hour.
7. **The codes' pepper is required wherever the site is on**, as the Worker refuses to start without it; production
   holds it.

## Consequences

- A client who books on the site types one code, on the site, and lands on their app's Home; a number we already know
  sees why nothing was booked, there or, where the client app is not on, on the page.
- A booking waits on one more read of D1, for the code, before anything else.
- The staging scripts and the timelapse prove their test numbers first, with staging's known code or the local one.
- Tests: `test/worker/site/consultations-one-visit.test.ts` and `test/worker/referrals/referrals-consultation.test.ts`
  refuse a booking without the code; `test/worker/site/consultations-known.test.ts` the answers to a number we know;
  `test/worker/site/number-codes.test.ts` the address's day; `test/worker/platform/guard.test.ts` the pepper;
  `withProof` in `test/worker/helpers.ts` sends every other booking as the site does; `e2e/book.e2e.ts`.
