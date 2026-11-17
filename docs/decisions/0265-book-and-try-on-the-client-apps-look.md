# 0265. `/book` and `/try` on the client app's look

- Status: accepted
- Date: 2026-11-17
- Topic: The site
- Follows [0121](0121-the-site-and-the-app-book-with-the-same-parts.md) and [0252](0252-client-app-redesign.md)

## Context

The site's booking and try-on already draw `packages/ui`'s parts (ADR 0121). The prototype draws both as the redesigned
client app draws its booking: a flow of its own, not a page of the site.

## Decision

1. **A flow frame.** On a phone, `/book` and `/try` fill the screen under the client app's top bar (back, title,
   close) and step bar, with no site header, footer or sticky bar. On a laptop, a slim bar with the lockup and "Back to
   the site" (and on `/try` "Free consultation" as an outline) sits over the flow; there is no footer.
2. **The client app's look values** for every shared part: buttons, fields, the day strip, start times (three to a
   row), radios, the code field, banners, errors.
3. **A shorter `/book` on a phone.** The page title shows on the first step only; the intro is one line; no "Step n"
   labels (the step bar carries them); "How it works" folds behind a disclosure on the first step; the visit step's
   one banner says the area is served and carries Change; the address step drops the repeated name, area and
   "Your address" lines and the long helper lines. A laptop keeps the full intro, the labels and the How it works column.
4. **The steps and their order stay** (name and mobile first, ADR 0116), with every state the code reaches today:
   requested, taken, errors, offline, nothing open, windows, the remembered invite, and the `?state=` previews.
5. **The one visit's note** says it is paid through a Razorpay link once fitted (ADR 0257), never UPI or cash, and is
   marked `PLACEHOLDER` until the owner gives its words, so production's build names it.
6. **Done** keeps the calendar links and "Open the app"; on navy its one filled button is gold.

## Consequences

- The referral landing `/r/:code`, which shares the island, takes the same look; it has no board, so its fidelity
  pairs against `/book`'s.
- `e2e/book*.e2e.ts`, `refer-landing.e2e.ts` and `try*.e2e.ts` keep their behaviour; selectors that named "Step n"
  labels move to the step bar's accessible name.
