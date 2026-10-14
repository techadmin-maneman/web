# Prompt for the coding agent — Mane Man Phase 1 front end, rev 2

_Paste verbatim. Supersedes rev 1, adding an explicit inventory of every v2 feature plus rulings on the prototype's demo controls. Pairs with the backend prompt rev 4.1. Builds `mm-site`, the public site and try-on, in the same repository as `mm-api`. The design is final: port it, do not redesign it._

---

## Task

Rebuild the final Claude Design, **Mane Man Site v2**, as a production site: an Astro static build served by the `mm-site` Worker with static assets. It is wired to the `mm-api` contract, fast on a mid-range Android on 4G, accessible, and measurable.

The design file is a prototype running React and Babel in the browser from unpkg. None of that runtime ships. Reproduce what it renders, not how it renders it.

## Inputs

Place the design export under `design/` in the repo, read-only:

| File | Use |
|---|---|
| `design/Mane Man Site v2.dc.html` | **The only source of truth** for layout, copy, states, breakpoints and behaviour |
| `design/support.js` | The prototype runtime. Needed only to render the design for comparison. |
| `design/assets/`, `design/brand/` | Images, hero video and poster, logo SVGs, favicons |
| `design/brand/README.md` | Logo rules. The wordmark is drawn: never set it in a typeface. Pick the cut by rendered width: the small cut below 112 px, the display cut from 112 px up. |

**Ignore every other file in the export.** That covers Mane Man Site (v1), Homepage, the standalone Try-on Tool, Mobile Preview, Client App, Referral and Waitlist, Phase 2 Prototype, Technician App and Ops Console. Several of them contradict v2, and the last two are dropped from the roadmap.

**The AILabTools harness at `C:\Users\X2\Side projects\AILabTool`.** Read `cloudflare/public/` only, for the browser-side photo resize and re-encode and the hair-colour detector. The same do-not-touch list as the backend prompt applies:
- `.env`, `.dev.vars`, `.studio-password.txt`
- `inputs/`, `out/`, `cache/`, `refs/`

## How to work

Four milestones. Stop at each, open a PR, and do not start the next until it merges.

Where the design and the API contract disagree, the contract wins on data and the design wins on everything visible. Record the conflict in an ADR.

---

## Stack, fixed

- Astro, static output. Interactive parts are islands with Preact, or React only if Preact blocks something, recorded in an ADR.
- TypeScript strict.
- Request and response types are generated from the backend's OpenAPI file with `openapi-typescript`. Never hand-write them.
- Styling is plain CSS, or CSS modules scoped per component. Every colour, size and space value comes from one tokens file extracted from the design and `brand/README.md`:
  - ink navy `#16233A`
  - gilt `#C9A363` (on ink only)
  - brass `#B98B45` (on paper only)
  - paper `#E9E4D8`
  - text `#1A1714`
  - the design's greys, borders and error reds, lifted exactly
- Fonts: EB Garamond and Instrument Sans, **self-hosted and subset** (both are under the SIL Open Font License). The design loads them from Google; production must not.
- No UI framework library, no CSS framework, no animation library.

## Routes

| Route | Content |
|---|---|
| `/` | Home, every section of v2 in order |
| `/try` | The try-on flow, v2's `route === 'tryon'` screens |
| `/book` | The booking form, plus its booked and waitlist states |
| `/privacy`, `/terms` | Long-form text pages in the site layout. The text is supplied later; ship a visible placeholder in staging only. |
| 404 | In the site layout |

`/#tryon` and `/#book` redirect client-side to `/try` and `/book`. The design used hash routes, and ad links already built on them must keep working.

## Fidelity

Match v2 at **390 px and 1440 px**, with the 760 px breakpoint exactly as the design sets it.

**Build a visual comparison harness.** Render the design file headless with Playwright. `support.js` fetches React 18.3.1, ReactDOM 18.3.1 and `@babel/standalone` 7.29.0 from unpkg; route those requests to local npm copies. Screenshot each section at both widths beside the built page. Commit the paired screenshots under `docs/fidelity/` for every milestone PR. Pixel-exactness is not required. Visible differences in type, spacing, colour or order are defects.

Motion as designed, with two conditions:
- Honour `prefers-reduced-motion` by pausing the hero video and disabling smooth scroll.
- The hero video is muted, looped, `playsinline`, with the poster as the LCP image, and loads with `preload="metadata"`.

## Feature inventory — the acceptance checklist

"Port every section" is not an acceptance test. The list below is every section, control and state in v2, taken from its template and its logic. Each item needs either a Playwright assertion or a fidelity screenshot pair. Each milestone PR includes `docs/feature-inventory.md` with every item it covers ticked and linked to its evidence.

**Global**
1. Header:
   - The mark and small wordmark cut.
   - Nav links *What it is*, *Prices* and *Questions*, which smooth-scroll to their sections with a 56 px header offset. From another route they go home first, then scroll.
   - The "Delhi NCR" tag and the *Book a visit* button.
   - Below 760 px the nav links are hidden. v2 has no menu button, so do not add one.
2. Sticky bottom bar, WhatsApp icon plus *Book a visit*:
   - Shown on the home route only, **at every width**, exactly as v2 does it.
   - The page reserves 72 px for it.
3. Footer:
   - Columns Service (*What it is*, *Prices*, *Try-on*), Reach us (WhatsApp, Phone), Legal (*Privacy*, *Terms*).
   - The service-area line and the entity name.
   - Shown on the home route only, as v2 does.
4. Every WhatsApp touchpoint opens `https://wa.me/<business number>` from content: the sticky bar, the footer, and "ask on WhatsApp" in the FAQ intro.
5. "Placeholder" tags follow v2's `showPlaceholderTags`: on in staging, off in production. Production has nothing left to tag, because of the publish gate.

**Home, in order**

6. Hero:
   - Looping muted video with poster and "Placeholder footage" tag.
   - Headline and sub-line.
   - *See yourself with hair* goes to `/try`; *Book a free measurement* goes to `/book`.
7. The full-bleed hair texture band.
8. *What it is*: three paragraphs, the last in the serif.
9. Norwood scale:
   - An early group (I–II, "nothing to fit yet") and a late group (III–VII, "we fit").
   - Each card has numeral, image, name, tag and description, with the tag and rule colours by group.
   - The "a system here would cover hair you still have" note.
   - Then *Book a free measurement*.
10. Comparison table:
    - Seven rows; ticks and crosses as SVG with text labels for screen readers.
    - Below 760 px the row label moves above each row and the columns go to three, as v2 does it.
11. Try-on teaser:
    - Copy and *Start the try-on*.
    - A draggable before/after slider starting at 46%, keyboard-operable.
12. The discretion band: one sentence, large serif.
13. *How it works*: four numbered steps with meta line and image.
14. *Who comes to your home*: three technician cards.
15. *Two bases, two prices*:
    - Two cards with photograph, the inline SVG base cross-section (membrane, knots and hair paths from v2's data), and Look, Breathability, Lifespan and First fit rows.
16. *Published prices*:
    - Intro line and the three-row table (standard and premium columns).
    - The first-year example and the payment line.
    - *Book a free measurement* and *Or see yourself with hair first*.
17. *What clients say*: three cards.
18. The guarantee.
19. The founder's note, with the mark.
20. FAQ:
    - Ten items, the **first open by default**, one open at a time.
    - Plus/minus sign.
    - Use a real disclosure pattern (button with `aria-expanded`, or `details`/`summary`).
21. Closing band: *The measurement takes forty minutes and costs nothing* with *Book a free measurement*.

**Try-on (`/try`)**

22. Chrome:
    - Back control with v2's exact mapping: upload → home; error → upload; result → gate; gate → looks; any other step → previous.
    - Step label ("Step one of five" … "Your result", "Cannot use this photograph").
    - Progress bar at v2's percentages.
23. Upload:
    - Three photo guidelines.
    - Photo preview frame.
    - *Choose a photograph* and *Use the camera*.
24. Consent:
    - Five rows.
    - Tickbox; the continue button is disabled until it is ticked.
    - The sentence about the privacy notice.
25. Stage: three illustrated options, single select, the first selected by default.
26. Looks:
    - Six tiles; the button label changes from *Choose one to continue* to *Generate the simulation* once one is picked.
27. Processing: the 20-second countdown and four ticked steps at 2, 6, 11 and 16 s.
28. Gate:
    - Name and mobile, with v2's inline errors.
    - The image column moves below the form under 760 px.
    - *Show me the result*.
    - The two reassurance lines.
29. Result:
    - Before/after slider starting at 50%, with *Drag the handle to compare*.
    - Chosen look label.
    - Simulation disclaimer.
    - *Book a free measurement*, *Download*, *WhatsApp*, *Try another look*.
    - The conditional copy line.
30. Error:
    - Heading and body, per the mapping in *API integration*.
    - *Choose another* returns to upload; *Book a visit instead* goes to `/book`.

**Booking (`/book`)**

31. Form:
    - Name.
    - Mobile with a fixed +91 and v2's 5-plus-5 digit grouping as the user types.
    - City select, with the inline "Not served yet — you will join the {city} list instead" note, driven by the `served` flag from `/api/cities`.
    - Preferred visit: four options, **weekday evening selected by default** as in v2.
    - Extent of hair loss: three illustrated options, the first selected by default.
    - Consent tickbox with its error state.
    - Button reads *Request a visit*, then *Sending* while in flight, and does not double-submit.
    - *We reply on WhatsApp inside a working day.*
32. Booked state:
    - Headline from the API.
    - The confirmation line.
    - Five rows: What happens, How long, To pay, Where, Confirming to.
    - The discretion note.
    - *Add to calendar* and *Back to the site*.
33. Waitlist state:
    - *On the list*, the explanatory line, and rows City, Number, Expected.
    - The note.
    - *Try the simulation meanwhile* and *Back to the site*.

**Rulings: things in the v2 file that do not ship**

- **The demo control *See what happens if the photo will not work*** on the upload step is a prototype device for previewing the error screen. Remove it. The error screen is reached only through a real failure.
- **Data arrays v2 defines but never renders:** `counts` ("10,000+ systems fitted", "10 years"), `numbers` ("180 hours of training", "48 hours"), `trust`, and the placeholder `testimonials` array. They are not part of the design. Do not build them, and do not move their claims onto the page.
- **v2's simulated timers:** the 1.4-second booking "send" and the fixed demo date "Thursday, 24 September". Replace them with the real API calls and fields. The layout does not change.
- **The privacy link on `/try`.** The consent sentence says the privacy notice is "linked in the footer", but v2 shows no footer on `/try`. Keep the sentence word for word and make the words "privacy notice" a link to `/privacy`. This is the only added link; it adds no visible element.

## Content

Every string and image reference lives in `src/content/site.ts`, not in components. This is what lets the placeholders ship safely.

- **Placeholder blocks** use v2's copy and images verbatim and carry `publish: false`. The production build **fails** while any published block still holds design placeholder content. These blocks are:
  - the three technicians
  - the three testimonials
  - the founder's note
  - the Norwood stage photographs
  - the before/after teaser
  - the two footer numbers

  In staging they render with the design's "Placeholder" tag. When a block is unpublished in production, its section collapses cleanly with no empty frame.
- **Notices**: the photo consent rows, the gate text and the booking consent line. Each carries a `version` that is sent to the API with the consent, and an `approved` flag. The production build fails while any notice is unapproved. Counsel is reviewing the photo notice's "Shared with" row.
- The Norwood section's fallback is the line-drawn profiles in v2's `_nwOld` data. It is selectable in content for when real images are not cleared.

## API integration

All calls are same-origin to `/api/*`. The contract is `docs/api.md` and the OpenAPI file from `mm-api`.

**Every mutating call:**
- A Turnstile token, using the managed widget rendered invisibly where the design has no slot for it.
- An `Idempotency-Key` header (a UUID per submission attempt) on lead and claim.
- The attribution captured on first landing: UTM fields, `gclid`, `fbclid`, referrer and landing path, held in `sessionStorage`.

**Booking, `/book`**
- The city select is populated from `GET /api/cities` in the order returned, not from a hard-coded list.
- Submit to `POST /api/lead`.
- On `served: true`, show v2's booked state. The headline is built from `proposed_visit_date` and `window_label`, for example "Thursday, 24 September, before noon." The rows show the returned number.
- On `served: false`, show v2's waitlist state with the chosen city. "Expected: First quarter, 2027" comes from content.
- **Add to calendar** generates an `.ics` file in the browser: the proposed date, 09:00–12:00 or 18:00–21:00 IST by window, titled "Mane Man measurement (time to be confirmed)".
- Validation and error states exactly as designed.

**Try-on, `/try`**, the v2 flow step by step:
1. **Photo.** "Choose a photograph" uses a file input. "Use the camera" uses the front camera via `capture="user"`. Then:
   - Port the harness's resize and re-encode: fit within 4090 px and under 5 MB, JPEG at quality 0.92. Re-encoding through canvas strips EXIF, including GPS location. Keep it that way.
   - Run the harness's colour detector. Map its result onto `black | brown | lightBrown | grey | silver | white`; anything else, or a decline, becomes `unknown`.
   - Keep the photograph in memory only. Nothing is stored in the browser.
2. **Consent.** The continue button stays disabled until the box is ticked, as designed. On continue:
   - Call `POST /api/tryon/upload-url` with `photo_consent: true` and the notice version.
   - `PUT` the image straight to the presigned URL.
3. **Stage.** As designed.
4. **Look.** Six tiles, labels and thumbnails from content. The preset IDs come from the backend's preset list and are not duplicated in the front end.
   - Generate calls `POST /api/tryon/generate` with `stage`, `preset` and `hair_color`.
   - A `503 busy` goes to the error screen.
5. **Processing.** v2's 20-second countdown and step ticks exactly as designed. They are presentational.
   - Poll `GET /api/tryon/status/:id` every 3 seconds.
   - A failure before the countdown ends goes to the error screen.
   - Otherwise advance to the gate at 20 seconds whether or not the render is ready. The backend accepts the gate before `ready`.
6. **Gate.** Name and mobile, validated as designed.
   - `POST /api/tryon/claim`.
   - The line "A copy is on its way to +91 …" on the result screen renders **only if** the response's `whatsapp_copy` is `true`.
7. **Result.**
   - Poll `GET /api/tryon/result/:id` every 3 seconds.
   - While the render is still running, keep v2's result layout with the after image in a loading state. No new screen.
   - On `200`, load the signed URL. Download and the WhatsApp share use the Web Share API where available, falling back to a `wa.me` link carrying text only, never the image URL.
   - "Try another look" returns to step 4 **without** the gate. The session cookie carries it.
8. **Error screen.** v2 has one error screen, and every failure uses its layout and its two buttons.
   - `photo_unreadable` and `photo_invalid_file` show v2's copy as designed.
   - `render_failed` and `busy` replace only the heading and the body line, from content. The design's copy blames the photograph, which is false for those two. This is the one sanctioned text deviation; record it in an ADR.

## Analytics

- Cloudflare Web Analytics.
- GA4, the Google Ads conversion tag and the Meta Pixel. Paid campaigns start from 19 Oct, and ad conversion import needs all three.
- Fire these events:
  - `try_on_started`, `try_on_completed`, `try_on_gate_shown`, `try_on_claimed`, `try_on_failed` (with `failure_code`), `try_on_additional_look`
  - `lead_submitted` (with `first_choice_window`, `loss_extent`, `city`, `served`), `waitlist_submitted`, `booking_confirmed`
- No name, mobile number or image reference in any payload, URL or tag. A test asserts it.
- Tag IDs are per environment. Staging sends to debug streams only.

## Quality bar, enforced in CI

- **Performance:**
  - LCP under 2.5 s, CLS under 0.1 and INP under 200 ms on Lighthouse's mobile profile.
  - Lighthouse at least 90 for performance and 95 for accessibility, best practices and SEO on `/`, `/try` and `/book`.
  - Island JavaScript under 60 KB gzipped on `/`. The try-on island loads only on `/try`.
- **Images:**
  - Every design image is served as AVIF or WebP with a responsive `srcset`, explicit dimensions and lazy loading below the fold.
  - Assets marked as placeholders are excluded from production bundles.
- **Accessibility, WCAG 2.2 AA:**
  - Every control works by keyboard, including both before/after sliders.
  - Visible focus states.
  - Labelled fields, with errors announced through `aria-live`.
  - The processing countdown does not spam screen readers.
  - `axe` checks run in Playwright.
- **SEO:**
  - A title, description and canonical on each route, with Open Graph and Twitter cards built from the brand kit.
  - `LocalBusiness` and `FAQPage` structured data, the FAQ taken from content.
  - A sitemap and `robots.txt`.
  - Staging is `noindex` and behind Cloudflare Access.
- **Security headers:**
  - A CSP allowing only self, Turnstile, the analytics hosts in use, and the R2 S3 endpoint for the presigned `PUT`.
  - HSTS, `Referrer-Policy: strict-origin-when-cross-origin`.
  - A `Permissions-Policy` that allows the camera on `/try` only.
- **End-to-end tests** with Playwright at 390 px and 1440 px against staging with backend stubs:
  - Booking in a served city, and booking in an unserved city.
  - The full try-on, including a gate submitted before the render finishes, a second look without a second gate, and each failure code.
  - The hash-route redirects.

## Milestones

- **F1 — Static port.** Can start now; needs no API.
  - Tokens, fonts, brand, content file, every home section, the static shells of `/try` and `/book` with mocked state switches, routes and redirects.
  - The fidelity harness and screenshots at both widths.
  - The placeholder and notice gates proven by a failing production build.
- **F2 — Booking.** Starts after backend M2 merges.
  - Cities, lead, the booked and waitlist states, the calendar file, attribution, Turnstile, idempotency.
  - Staging proof: a booking lands in the Zoho Developer Edition with its proposed date.
- **F3 — Try-on.** Starts after backend M3 merges.
  - The photo pipeline and colour detector, upload, generate, status, gate, result, additional looks, the error mapping, the conditional WhatsApp line.
  - Staging proof: a real render on a phone over 4G, and the gate submitted before the render finishes.
- **F4 — Launch hardening.**
  - Analytics and conversion tags, SEO, performance and accessibility budgets green in CI, the security headers, and a full Playwright run.
  - Then one production release, together with the backend.

## Deliverables

- `apps/site/` (or the repo's existing layout for `mm-site`) and `src/content/site.ts`.
- The tokens file.
- The fidelity harness and `docs/fidelity/`.
- Playwright and Lighthouse CI configuration.
- ADRs.
- `docs/feature-inventory.md`, every item ticked with its evidence.
- `docs/frontend.md`, covering how to edit content, how to publish a placeholder block once real material exists, and how to change a preset label.

## Out of scope

- Any backend code.
- Any Phase 2 screen.
- Any redesign. When something in v2 looks wrong, raise it in the PR; do not change it.
