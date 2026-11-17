# The site redesign: plan

The brief is `docs/prompts/site-redesign.md`; the prototype is `design/site-redesign/` (24 boards, 60 screens, 17
November 2026). This plan maps every board and state to what builds it, every asset to the file that fills it, the token
changes, and the departures expected. ADRs 0262 to 0265 hold the decisions; each lands before the code it governs.
The boards and the README are committed; the 60 screens (23.6 MB of PNGs) stay out of git and on the build machine,
since `design/` holds no PNGs and they would add nearly a third to every clone. The fidelity check reads the boards.

## What does not change

Content (`site/src/content/`), assets (`site/src/assets`, `design/brand`), the islands' logic and API calls, the five
notices and their versions, analytics events (ADR 0023), `_headers` and the CSP, the publish and content gates, the
Worker's rewrites, `?state=` previews, and the Lighthouse budgets. No endpoint, migration or setting.

## Boards to pages

| Board (390 / 1440)                     | Screens                                                     | Builds it                                                                 | Content keys                                                |
| -------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `Main` / `LaptopHome`                  | `*-01-home`                                                 | `pages/index.astro`, `components/home/*`, `Header`, `Footer`, `StickyBar` | `site/home.ts`, `site/media.ts`, `service.ts`               |
| `PhoneBook` / `LaptopBook`             | `*-02-book-1` to `7`                                        | `pages/book.astro`, `islands/invite/*` on `packages/ui`, a new flow frame | `referral.ts`, `site/pages.ts` (`booking`)                  |
| `PhoneTry` / `LaptopTry`               | `*-03-try-1` to `7`                                         | `pages/try.astro`, `islands/tryon/*`, the flow frame                      | `site/tryon.ts`                                             |
| `PhoneGuides` / `LaptopGuides`         | `*-04-guides-index`, `-what`                                | `routes/guides.astro`, `pages/guides/[slug].astro`, `TextPage`            | `guides.ts`                                                 |
| `PhoneAreas` / `LaptopAreas`           | `*-05-areas-index`, `-gurgaon`                              | `routes/areas.astro`, `pages/areas/[city].astro`                          | `guides.ts` (`areasPage`)                                   |
| `PhoneAftercare` / `LaptopAftercare`   | `*-06-aftercare`                                            | `pages/aftercare.astro`, `LegalPage`, `LegalBlocks`                       | `site/aftercare.ts`                                         |
| `PhonePrivacy` / `LaptopPrivacy`       | `*-07-privacy`                                              | `pages/privacy.astro`, `LegalPage`                                        | `site/privacy-policy.ts` (full text, not the board's stubs) |
| `PhoneTerms` / `LaptopTerms`           | `*-08-terms`                                                | `pages/terms.astro`, `LegalPage`                                          | `site/terms-and-conditions.ts` (full text)                  |
| `PhoneNotices` / `LaptopNotices`       | `*-09-notices`                                              | `pages/notices.astro`, `TextPage`                                         | `site/notices.ts`                                           |
| `PhoneOfferTerms` / `LaptopOfferTerms` | `*-10-offer-terms`                                          | `pages/offer-terms.astro`, `LegalPage`                                    | `site/offer-terms.ts`                                       |
| `PhoneStop` / `LaptopStop`             | `*-11-stop-ask`, `-done`, `-visits`, `-expired`, `-offline` | `pages/stop.astro`, `islands/StopMessages.tsx`                            | `site/pages.ts` (`stopMessages`)                            |
| `PhoneNotFound` / `LaptopNotFound`     | `*-12-404`                                                  | `pages/404.astro`                                                         | `site/pages.ts`                                             |

The referral landing (`/r/:code`) has no board. It shares `/book`'s island and takes `/book`'s look; its fidelity stays
`fidelity:refer`'s, reshot.

### Home, section by section

| #   | Section               | Ground    | Component                                                                     | Change                                                                                                                                                                                                                                                                          |
| --- | --------------------- | --------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Hero                  | navy film | `home/Hero.astro`, `lib/hero.ts`, `lib/hero-film.ts`                          | Plex; copy on the page column, bottom left; "{serviceArea} · home service" top left and Pause top right on the column; Book gold and first, Try outline; buttons stacked full width on a phone. Film, cut, poster, overlays, turning line and its refusals unchanged (ADR 0264) |
| 2   | Results               | white     | `home/Results.astro`, `islands/ResultsGallery.tsx`, `islands/BeforeAfter.tsx` | Title left, slider, caption, "n of 4", previous and next; all four `resultPairs`                                                                                                                                                                                                |
| 3   | What it is            | cool      | `home/WhatItIs.astro`                                                         | Statement under a 2 px navy rule                                                                                                                                                                                                                                                |
| 4   | Norwood               | white     | `home/Norwood.astro`                                                          | Laptop: one row, as now. Phone: a stage picker (new island) over two tiles; Book filled navy                                                                                                                                                                                    |
| 5   | Comparison            | cool      | `home/Comparison.astro`, `CompareTable.astro`                                 | Header as navy text over a 2 px navy rule; hair-system column in white. Phone: a Transplant / Medication toggle (see departures)                                                                                                                                                |
| 6   | Try-on teaser         | navy      | `home/TryOnTeaser.astro`, `BeforeAfter`                                       | Restyle; gold "Start the try-on"                                                                                                                                                                                                                                                |
| 7   | How it works          | white     | `home/HowItWorks.astro`; `home/DiscretionBand.astro` folds into it            | Three steps with photos; the "at your own table" statement closes the section under a 2 px navy rule                                                                                                                                                                            |
| 8   | The range             | cool      | `home/Range.astro`, `CompareTable.astro`                                      | Laptop table, header as in 5. Phone: four-way toggle over key and value rows                                                                                                                                                                                                    |
| 9   | Guarantee and founder | white     | `home/GuaranteeFounder.astro`, `Disclosure.astro`                             | Founder's first paragraph shown; "Read the full note" discloses the rest in place                                                                                                                                                                                               |
| 10  | Questions             | cool      | `home/Faq.astro`                                                              | Restyle                                                                                                                                                                                                                                                                         |
| 11  | Closing               | navy      | `home/Closing.astro`                                                          | Restyle; gold Book                                                                                                                                                                                                                                                              |

The Norwood picker and the two toggles are small Preact islands (`client:visible`), each a `packages/ui` segmented
control with `aria-pressed`. Without JavaScript the first option shows, and every option's content is in the page.

### Header, footer, sticky bar, flow frame

- **Header** (`Header.astro`): phone, the lockup, "Sign in" and "Free consultation" filled navy; laptop, the lockup, the
  three section links, "Sign in" and "Book a free consultation" filled navy. The "Delhi NCR" tag goes (it moves to the
  hero). "Sign in" opens the client app (`lib/app-link.ts`, `clientAppOrigin`); where the app is not switched on, as in
  production until its release, the link is left out rather than pointing at a host that does not answer.
- **Footer** (`Footer.astro`, `SlimFooter.astro`): as live, navy, a `navy-700` rule above it, without its Book button.
- **Sticky bar** (`StickyBar.astro`): as live, WhatsApp and Book, shown on phones once the hero has passed.
- **Flow frame** (new, `layouts/Flow.astro`): `/book` and `/try` on a phone are full-screen flows with the client app's
  top bar (back, title, close) and step bar, no site header or footer. On a laptop: the lockup, "Back to the site" (and
  on `/try`, "Free consultation" as an outline), then the flow, no footer. ADR 0265.

### `/book` states (ADR 0081, 0116, 0118, 0217)

| Screen           | State in code                                                                                 | Notes                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `book-1-you`     | step `start`                                                                                  | Phone: title on the first step only, one-line intro (copy change 4), "How it works" folded behind a disclosure; laptop keeps both intro paragraphs and the How it works column |
| `book-2-area`    | step `pincode`                                                                                | Phone: no "Step n" label; the step bar carries it                                                                                                                              |
| `book-3-visit`   | step `visit` (`ConsultationFields`)                                                           | One banner "We come to …" with Change; plan radios with lengths from the API; day strip; start times in three columns (`--time-columns: 3`) or windows                         |
| `book-4-address` | step `address` with the WhatsApp code                                                         | Phone drops the repeated name, area and "Your address" lines and the long helper lines; building search stays                                                                  |
| `book-5-nots`    | step `waitlist`                                                                               | —                                                                                                                                                                              |
| `book-6-listed`  | view `listed`                                                                                 | One filled button                                                                                                                                                              |
| `book-7-done`    | view `booked`                                                                                 | Navy, gold "Open the app", calendar links kept                                                                                                                                 |
| not drawn        | requested, taken, errors, offline, nothing open, windows, invite remembered, ?state= previews | Drawn with the same parts, as the client app draws them                                                                                                                        |

### `/try` states (ADR 0104, 0217)

`try-1-photo` = `upload`; `try-2-check` = the capture dialog; `try-3-look` = `looks` (real `look-*.jpg`, not the board's
grey stand-ins); `try-4-send` = `gate` with the WhatsApp code; `try-5-sent` = `sent`; `try-6-ready` = `sent.ready`;
`try-7-error` = `error` (all eleven kinds take it). Not drawn but kept: camera, camera blocked, no camera, too dark,
too small, returning, every gate refusal.

## Assets

Every slot reuses the file it uses today, through the same entry. Nothing is added to `site/src/assets`.

| Slot                      | Entry                                             | Files                                                             |
| ------------------------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| Lockup, header and footer | `packages/brand/marks.ts`                         | `design/brand/lockup-navy.svg`, `lockup-white.svg`                |
| Hero film                 | `heroFootage`, `lib/hero-film.ts`                 | `fit-film.mp4`, `fit-film-phone.mp4`, `fit-film-poster.jpg`       |
| Results                   | `resultPairs`                                     | `result-1..4-before.jpg`, `result-1..4-after.jpg`                 |
| Norwood stages, restored  | `norwoodPhotos`, `norwoodRestored`                | `norwood-3..7.jpg`, `norwood-restored.jpg`                        |
| Try-on teaser             | `teaserPair`                                      | `tryon-before.jpg`, `tryon-after.jpg`                             |
| How it works              | `stepPhotos`                                      | `step-consultation.jpg`, `step-first-fit.jpg`, `step-service.jpg` |
| `/try` looks              | `src/config/presets.ts`, `lib/look-thumbnails.ts` | `look-*.jpg`                                                      |
| Guides                    | `content/guides.ts`                               | `guide-*.jpg`                                                     |
| Icons                     | `packages/brand/icons.ts`                         | —                                                                 |

A test asserts the set of files in `site/src/assets` is unchanged by the redesign.

## Tokens (ADR 0262)

- **Palette.** In `packages/brand/tokens.css`, the primitives the brief names already exist (`--ink` #16233A,
  `--navy-700`, `--navy-800`, `--gilt` #C9A363, `--brass`, `--white-000`, `--line-200`, `--ink-900`, `--ink-500`,
  `--mist-300`, `--ink-night`, `--red-700`, `--red-050`). Two are new: `--cool-100` #F1F3F6 and `--gilt-hover` #D4B47A.
  `site/src/styles/tokens-site.css` maps the site's roles onto them (`--site-ground`, `--site-band`, `--site-navy`,
  `--site-line`, `--site-text`, `--site-text-muted`, `--site-on-navy-muted`, `--site-focus`, the button roles) and stops
  reading `--paper` and `--wash-100`. A test fails a site stylesheet or built page that draws `#E9E4D8` or `#F4F0E8`.
- **Type.** `packages/brand/fonts-plex.css` replaces `fonts.css` on the site; EB Garamond and Instrument Sans leave
  the site's build. Plex draws ₹ from its Devanagari file (`fonts-plex.css` ranges it over U+20B9), so the one-glyph
  rupee file goes too. The clamp scale: turning line 40–80, hero title 20–26, section 26–44, statement 20–34, lead 16–18, body 16, labels 14,
  buttons 16, written once as `--site-fs-*` with `clamp()` between 390 and 1440 px.
- **Space.** Column 1200 px, gutters 20 / 40 px; section padding 56 / 96 px; buttons 52 px; header buttons 40 / 44 px.
- **Radius.** 0; circles only for radio dots, the spinner and the slider knob.
- **`/book` and `/try`** take the client app's look values (`apps/app/src/styles/look.css` roles), so the shared parts
  draw alike (ADR 0121).

## Copy changes (the only new strings)

1. `hero.area`: "{serviceArea} · home service".
2. `founderNote.more`: "Read the full note".
3. `norwood.picker`: label "Choose your stage"; option "Stage {numeral}, {name}".
4. `booking.introShort`: "{visitLength.consultation} at your home, completely free." (phone, first step).
5. `referral.consultation.plan.oneVisitNote`: "Paid through a Razorpay link once you're fitted. Decide against it and
   you pay nothing." marked `PLACEHOLDER` for the owner's wording.
6. Durations are the live sentences with the console's lengths.

**Not in the brief's copy list, but named in its Header section:** "Sign in", the header's link to the client app
(`header.signIn`). The only missing string; the brief gives its words, so it is not marked `PLACEHOLDER`.

The flow frame's other words are live strings, reused by key: "Free consultation" (`header.bookShort`), "Try-on"
(`tryOnTeaser.eyebrow`), "Back" (`tryOn.back`), "Back to the site" (`tryOn.backToSite`), "Close"
(`tryOn.upload.capture.close`).

## Departures expected

1. **Phone comparison and range.** The brief says "the Transplant and Medication toggle, as now", but live draws
   swipeable cards (#783). The prototype draws segmented toggles; the prototype wins on look, so the cards become
   toggles.
2. **Two filled buttons in one viewport.** At the Norwood section on a laptop the sticky header's "Book a free
   consultation" and the section's own Book button are both filled navy and both on screen. The prototype draws it;
   kept, and recorded.
3. **Board stand-ins**: one results pair, grey look thumbnails, guide photographs, "Prototype:" lines and the stubbed
   clauses in privacy and terms are not built; the real content is.
4. **The one visit's length** reads as the API gives it; the board's "2.5 hours" shows only if ops set it.
5. **"10,000+ transformations"** is live copy with no source in the repository; kept, listed for the owner.
6. **"Sign in" in production** is left out until the client app is switched on there.

## How each PR is verified

`npm test`, `npm run typecheck`, `npm run lint`, `npm run check:site`, the site's Playwright projects (390, 1440),
`npm run fidelity` against `design/site-redesign/boards`, and `npm run lighthouse` on PR 8. New tests: the Norwood
picker, the founder's disclosure, the hero's Pause with the film, the phone `/book` disclosures, the two toggles, no
paper or wash drawn, no typed visit length, the asset set unchanged. Screenshots at 360, 390 and 1440 px (and 130% text
where touched) for `ui-guard`.

## PRs

1. Fidelity on `design/site-redesign/boards`; tokens (palette, Plex, type and space scale); the old fonts out.
2. Header, footer, sticky bar, slim header and footer, the flow frame.
3. Hero.
4. Home sections 2 to 11, with the bands, the picker and the toggles.
5. `/book` on the client app's parts, phone and laptop.
6. `/try` on the client app's parts, phone and laptop.
7. Guides, areas and the text pages.
8. 360, 768, 130% text, reduced motion, Save-Data; Lighthouse; `REPORT.md`.
