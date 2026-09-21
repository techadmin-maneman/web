# Feature inventory

Every section, control and state in v2, from the front-end prompt's list. Each is ticked for the milestone that delivers it, with its evidence:

- a fidelity pair: `docs/fidelity/<width>/<name>.jpg`, the design on the left and the build on the right;
- or a browser test in `e2e/`.

✅ means done in F1. Where a later milestone adds behaviour, the item says what.

## Global

| #   | Item                                                                                                                                                                                                                                                 | F1  | Evidence                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | Header: the mark and small wordmark; _What it is_, _Prices_, _Questions_ scrolling to their sections 56 px below the header, and from another page going home first; "Delhi NCR"; _Book a visit_; below 760 px the links hidden, with no menu button | ✅  | `chrome-header` pairs; `e2e/home.e2e.ts` › header (4 tests)                                                       |
| 2   | Sticky bar with WhatsApp and _Book a visit_: home only, at every width; 72 px kept for it                                                                                                                                                            | ✅  | `chrome-sticky-bar` pairs; `e2e/home.e2e.ts` › sticky bar and footer                                              |
| 3   | Footer: Service, Reach us and Legal columns, the service area and the entity; home only                                                                                                                                                              | ✅  | `home-15-footer` pairs; `e2e/home.e2e.ts` › sticky bar and footer. The wordmark is the display cut (ADR 0022, 6)  |
| 4   | Every WhatsApp touchpoint opens `wa.me/<business number>` from content: sticky bar, footer, FAQ intro                                                                                                                                                | ✅  | `e2e/home.e2e.ts` › WhatsApp. The number is the footer's placeholder until the real one is supplied (ADR 0022, 9) |
| 5   | Placeholder tags: on in staging, off in production                                                                                                                                                                                                   | ✅  | `e2e/home.e2e.ts` › shows the design's Placeholder tags; `test/node/site-content.test.ts` › the publish gate      |

## Home, in order

| #   | Item                                                                                                                                                             | F1  | Evidence                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------ |
| 6   | Hero: looping muted footage with poster and "Placeholder footage"; headline and sub-line; _See yourself with hair_ → `/try`; _Book a free measurement_ → `/book` | ✅  | `home-01-hero` pairs; `e2e/home.e2e.ts` › hero calls to action, the hero footage, reduced motion |
| 7   | The full-bleed band: the membrane plate that opens "What it is" (v2 has no separate texture band; ADR 0022, 3)                                                   | ✅  | `home-02-what` pairs                                                                             |
| 8   | _What it is_: three paragraphs, the last in the serif                                                                                                            | ✅  | `home-02-what` pairs                                                                             |
| 9   | Norwood: I–II "nothing to fit yet", III–VII "we fit", with tag and rule colours by group; the note; _Book a free measurement_                                    | ✅  | `home-03-norwood` pairs; `e2e/home.e2e.ts` › Norwood                                             |
| 10  | Comparison: seven rows, ticks and crosses read as Yes and No; below 760 px the label above each row and three columns                                            | ✅  | `home-04-comparison` pairs; `e2e/home.e2e.ts` › comparison (2 tests)                             |
| 11  | Try-on teaser: copy, _Start the try-on_, a before/after slider from 46%, keyboard-operable                                                                       | ✅  | `home-05-teaser` pairs; `e2e/home.e2e.ts` › the teaser slider                                    |
| 12  | The discretion band                                                                                                                                              | ✅  | `home-06-discretion` pairs                                                                       |
| 13  | _How it works_: four numbered steps with meta line and image                                                                                                     | ✅  | `home-07-how` pairs; `e2e/home.e2e.ts` › how it works                                            |
| 14  | _Who comes to your home_: three technician cards                                                                                                                 | ✅  | `home-08-technicians` pairs; `e2e/home.e2e.ts` › technicians, bases and testimonials             |
| 15  | _Two bases, two prices_: photograph, the cross-section drawing from v2's data, and the four rows                                                                 | ✅  | `home-09-bases` pairs (labels: ADR 0022, 5)                                                      |
| 16  | _Published prices_: intro, the three-row table, the first-year example and payment line, both calls to action                                                    | ✅  | `home-10-prices` pairs; `e2e/home.e2e.ts` › prices                                               |
| 17  | _What clients say_: three cards                                                                                                                                  | ✅  | `home-11-testimonials` pairs                                                                     |
| 18  | The guarantee                                                                                                                                                    | ✅  | `home-12-guarantee` pairs                                                                        |
| 19  | The founder's note, with the mark                                                                                                                                | ✅  | `home-12-guarantee` pairs                                                                        |
| 20  | FAQ: ten items, the first open, one open at a time, plus and minus, a real disclosure                                                                            | ✅  | `home-13-faq` pairs; `e2e/home.e2e.ts` › FAQ                                                     |
| 21  | Closing band                                                                                                                                                     | ✅  | `home-14-closing` pairs; `e2e/home.e2e.ts` › the closing band                                    |

## Try-on (`/try`)

In F1 the try-on runs on its own, as the prototype does. F3 adds uploads, renders and the claim.

| #   | Item                                                                                                                                        | F1       | Evidence                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 22  | Back control with v2's mapping; step labels; progress at v2's percentages                                                                   | ✅       | `e2e/try.e2e.ts` › chrome (16 tests); `try-*` pairs                                                                                 |
| 23  | Upload: three guidelines, the photo preview frame, _Choose a photograph_, _Use the camera_ (front camera); no demo link to the error screen | ✅ shell | `try-1-upload` pairs; `e2e/try.e2e.ts` › upload. F3: resize, re-encode and the colour detector                                      |
| 24  | Consent: five rows, a tickbox that Continue waits for, the privacy sentence linking "privacy notice"                                        | ✅       | `try-2-consent` pairs; `e2e/try.e2e.ts` › consent. F3: the upload call                                                              |
| 25  | Stage: three illustrated options, the first chosen                                                                                          | ✅       | `try-3-stage` pairs; `e2e/try.e2e.ts` › three stages                                                                                |
| 26  | Looks: six tiles; _Choose one to continue_ becomes _Generate the simulation_                                                                | ✅       | `try-4-looks` pairs; `e2e/try.e2e.ts` › six looks. F3: generate; the one-look ruling (ADR 0022, 2)                                  |
| 27  | Processing: the 20-second countdown, ticks at 2, 6, 11 and 16 s, quiet for screen readers                                                   | ✅       | `try-5-processing` pairs; `e2e/try.e2e.ts` › processing. F3: status polling                                                         |
| 28  | Gate: name and mobile with v2's errors; the image column below the form under 760 px; the two reassurance lines                             | ✅       | `try-6-gate` pairs; `e2e/try.e2e.ts` › gate (2 tests). F3: the claim                                                                |
| 29  | Result: slider from 50%, the chosen look, the disclaimer, the four actions, the copy line                                                   | ✅ shell | `try-7-result` pairs; `e2e/try.e2e.ts` › result. F3: the real image, Download and WhatsApp, the copy line only when `whatsapp_copy` |
| 30  | Error: heading and body, _Choose another_ → upload, _Book a visit instead_ → `/book`                                                        | ✅ shell | `try-8-error` pairs; `e2e/try.e2e.ts` › error. F3: the failure mapping                                                              |

## Booking (`/book`)

In F1 the form submits to a stand-in. F2 adds `/api/cities`, `/api/lead`, Turnstile, attribution and the calendar file.

| #   | Item                                                                                                                                                                                                                                                                        | F1       | Evidence                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| 31  | Form: name; mobile with a fixed +91 and 5-plus-5 grouping; city with the "Not served yet" note; four visit windows, weekday evening chosen; three extents, the first chosen; the consent box and its error; _Request a visit_ → _Sending_, no double submit; the reply line | ✅ shell | `book-1-form` pairs (layout: ADR 0022, 4); `e2e/book.e2e.ts` (5 tests)                                             |
| 32  | Booked: the headline, the confirmation line, the five rows, the discretion note, _Add to calendar_, _Back to the site_                                                                                                                                                      | ✅ shell | `book-2-booked` pairs; `e2e/book.e2e.ts` › a served city is booked. F2: the API's date and window, the `.ics` file |
| 33  | Waitlist: _On the list_, the line, City, Number and Expected, the note, _Try the simulation meanwhile_, _Back to the site_                                                                                                                                                  | ✅ shell | `book-3-waitlist` pairs; `e2e/book.e2e.ts` › an unserved city joins its list                                       |

## Rulings

| Ruling                                                                              | Evidence                                                           |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| The demo control _See what happens if the photo will not work_ is removed           | `e2e/try.e2e.ts` › three guidelines, two ways in, and no demo link |
| `counts`, `numbers`, `trust` and the placeholder `testimonials` array are not built | Not in `site.ts`                                                   |
| v2's simulated timers are replaced by API calls                                     | F2 and F3                                                          |
| "privacy notice" links to `/privacy`, and nothing else is added                     | `e2e/try.e2e.ts` › the words privacy notice link to /privacy       |
| `/#tryon` and `/#book` redirect                                                     | `e2e/home.e2e.ts` › hash routes from v2                            |
| The production build fails while placeholders or unapproved notices remain          | `test/node/site-production-gate.test.ts`                           |
