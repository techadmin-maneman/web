# 0040. Phase 1 aligned with Phase 2: the evening window, and "consultation"

- Status: accepted
- Date: 2026-09-22
- Topic: Booking and visits

## Context

Phase 1 and Phase 2 disagree on two things a visitor sees on the public site today:

- **The evening window.** Phase 1 offers "after six", and its calendar file books 6 to 9 pm. Phase 2's client app offers morning 9–12, afternoon 12–4 and evening 4–8.
- **The first visit's name.** Phase 1 calls it a "measurement" throughout ("Book a free measurement"), as its design does. Phase 2 calls it a "consultation" throughout: the login rule, the referral landing, the client app's lead state.

The owner ruled on 22 September 2026 that **Phase 2 wins** (ADR 0025, item 4). This departs from the Phase 2 front-end prompt, which allows no change to the Phase 1 site beyond `/r/:code`.

## Decision

**The evening window is 4 to 8 pm.**

- `windowLabel` (`src/config/booking.ts`) says "after four", so the booked page's headline reads "Thursday, 24 September, after four." The lead API's `window_label` has the same value.
- The calendar file books 16:00 to 20:00 in India's time (`site/src/lib/calendar.ts`).
- The morning window was already 9 to noon on both sides.
- The four first-choice windows and their stored values (`weekday_pm` and the rest) are unchanged, so no lead, no Zoho field and no migration changes. Ops see the same "Weekday evening" in Zoho, which now means 4 to 8.

**The first visit is a "consultation".** Every place the site names the visit changes:

- the "Book a free consultation" buttons, and the booking page's title;
- the booked page ("Your consultation is booked."; "Consultation, not a fitting");
- the How it works step ("Consultation at home");
- the closing band and the FAQ;
- the try-on's error screens;
- the terms ("The first visit is a consultation");
- the calendar event and its file name (`mane-man-consultation.ics`);
- the lead route's summary in the API contract.

Where the copy says what happens at that visit, the verb stays: "He measures your scalp and matches your colour", "He measures properly at the visit". So does the photograph whose alt text describes a notebook of scalp measurements.

**The payment copy does not change yet.** "Paid on the day of the fit", "no deposit" and "move or cancel at no charge" stay until self-serve payment goes live in P2-M5, so each is true on the days it is shown (ADR 0025, item 4).

## Consequences

- **The words depart from the Phase 1 design** (ADR 0022, item 36). The fidelity pairs show the new words beside v2's old ones, and the pairs are otherwise unchanged.
- **The contract changes.** `window_label` is now `before noon` or `after four`, and `docs/openapi.json`, `docs/api.md` and the site's types are regenerated. The API deploys just before the site, so for a moment an old page can receive "after four". Its calendar file then falls back to the morning window, and the headline still reads correctly. Production is not yet live.
- **The terms change in one word.** The owner approved the terms on 22 September 2026; "measurement" becomes "consultation" in the second paragraph.
- **Tests:** the booking, content, lead and visit-date tests, and the browser tests for the home, booking, try-on and launch pages, now expect the new words and hours.
