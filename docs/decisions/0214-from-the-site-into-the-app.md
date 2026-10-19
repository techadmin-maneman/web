# 0214. From the site into the app, and the look on the page

- Status: accepted
- Date: 2026-10-19
- Topic: The site
- Amends [0104](0104-the-try-ons-look-on-whatsapp-only.md) and [0116](0116-book-asks-for-the-name-and-number-first.md)

## Context

On 19 October 2026 the owner asked why the try-on's look is not shown on /try or in the app once it is made; why
someone who gave their name and number at the try-on is asked for them again on /book; and that a booking take the
client into the app, signed in, automatically.

A number typed on the site may not be its typist's. ADR 0104 sent the look to WhatsApp only for that reason, and the
booked screen's link to the app fills the number in but still asks its code. Since 2 October a WhatsApp code proves
the number at the try-on's gate, and at the consultation and fit in one visit.

## Decision

1. **The look on the page.** `GET /api/tryon/status/{job_id}` gives a ready try-on whose number the gate's code proved
   a `look`: a signed path to the image (`/api/result/{token}`), which expires within the hour. The sent screen shows
   it beside the photograph on the shared compare, and the look still goes to WhatsApp. The notices say so: photo-v6
   and gate-v6, which await counsel (open point 146), and the privacy notice and terms. The app shows the try-on under
   Photos, as before (ADR 0082).
2. **The try-on's name and number, kept for the tab.** The gate keeps the name, the number and the code that proved
   it in `sessionStorage`, gone when the tab closes; /book and the invite's consultation form start from them.
3. **Signed in from a booking, where the number was proved.** `POST /api/number-code/sign-in` takes a code that
   proved a number in the last 30 minutes and, once a booking holds the number, answers a sign-in challenge and its
   code, sending nothing. The site opens the app at `/#signin=<challenge>.<code>`, and the app finishes it at
   `POST /api/auth/verify` as it opens, once. A booking for a number not proved signs nobody in: its link still fills
   the number in and asks its code.

## Consequences

- A client who did the try-on, or booked a consultation and fit, goes from the booking straight to their app's Home.
  One who only booked a free consultation types one code.
- Tests: `test/worker/site/number-sign-in.test.ts`, `test/worker/site/tryon-api-render.test.ts`,
  `test/node/apps/app/app-linked-mobile.test.ts`, `e2e/try-flow.e2e.ts`.
