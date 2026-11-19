# 0285. Every booking on the site asks the WhatsApp code, and signs the client in

- Status: accepted, on the owner's ruling of 19 November 2026
- Date: 2026-11-19
- Topic: The site
- Amends [0214](0214-from-the-site-into-the-app.md) and [0081](0081-the-site-takes-the-address.md) on which bookings ask the number's code

## Context

Since 2 October a WhatsApp code proved the number for the consultation and fit in one visit only (0081, amended), and
a booking whose number was proved went on into the client app signed in (0214, decision 3). A free consultation asked
no code, so its client typed a code again in the app, and a number the site already knew was answered as a new one
would be, with a day and calendar buttons for a visit that was never made (QA finding A-011), since whoever typed it
might not hold it.

The owner ruled, 19 November, that every booking on the site asks the code and, once it is entered, treats it as a
sign-in and shows the client the signed-in app; and that the waitlist asks none.

## Decision

1. **Every booking asks the code.** `POST /api/consultation` and `POST /api/r/{code}/consultation` refuse
   `403 number_not_proved` without a `number_code_id` that proved the number in the last 30 minutes, for the
   consultation alone as for the one visit, on the site's own page, an invite's and a partner's. Nothing is looked up
   or written for the number before.
2. **The form sends the code first.** Its button sends the code to the number, then reads "Confirm and book" until it
   is entered; a code the tab proved in the last 30 minutes is not asked again.
3. **The booking signs the client in** as 0214's decision 3 does, now for every booking: where the client app is on,
   the page opens it signed in.
4. **The waitlist asks no code.** Nothing is booked, and nobody is signed in.

## Consequences

- A client who books on the site types one code, on the site, and lands on their app's Home; a number we already know
  sees what its account holds there, not the booked page's day.
- Where the client app is not on (production until its release), the page answers as before: a known number is still
  answered as a new one would be, and its owner is told the rest on WhatsApp.
- A booking waits on one more read of D1, for the code, before anything else.
- Tests: `test/worker/site/consultations-one-visit.test.ts` refuses the consultation alone without the code;
  `withProof` in `test/worker/helpers.ts` sends every other booking as the site does; `e2e/book.e2e.ts`.
