# 0043. The client app: build, Worker and policy

- Status: accepted. Amended 2 October 2026: Checkout lists the ways to pay, so the pay step chooses none first and C6 offers "Try again" alone.
- Date: 2026-09-22

## Context

The Phase 2 front-end prompt sets the client app's stack and bars:

- **Stack:** "React with Vite, as a single-page PWA … TypeScript strict. No UI framework", on `app.maneman.in` as the Worker `mm-app` with static assets.
- **Performance:** a first load under 150 KB of gzipped JavaScript.
- **Security:** a content security policy of its own, allowing the backend and Razorpay's hosts, and no analytics. (Corrected 27 September 2026: this said Cloudflare Web Analytics was allowed. The policy has never named its hosts, `apps/app/headers.ts`, so the app counts no visits; whether it should is `docs/open-points.md`, item 144.)
- **Layout:** the design is drawn at 390 px. The column fills a phone up to 480 px wide, and wider screens centre it.

The API it calls is mm-api's client surface on the same host (ADR 0026). Only the public site and the staging surfaces are live.

## Decision

**A workspace of its own.** `apps/app` is an npm workspace (ADR 0037):

- **React 19.3 is pinned inside it.** React 18.3.1 stays at the repository root, where the fidelity harness renders the design with it.
- **Vite 8.3 builds it.** Astro already brought Vite 8.3 into the repository.
- **Styles are CSS modules on the brand's tokens** (`packages/brand`). `test/node/app-tokens.test.ts` refuses a raw colour or size, an undefined token, and an inline `style`. Since 2 October 2026 the policy allows inline styles, for Razorpay Checkout's own; the app writes none.
- **Every word is in `apps/app/src/content.ts`,** from the design.

**One build per environment.** `npm run build:app -- --env <env>` writes `apps/app/dist/<env>` (`scripts/build-app.ts`), with a `_headers` file from `packages/web-kit`:

- **The content security policy:**
  - `default-src 'none'`;
  - scripts, styles, fonts, images, the manifest, workers and API calls from the app's own origin only;
  - no inline code of any kind (since 2 October 2026, inline styles are allowed for Razorpay Checkout; see "The policy" below);
  - no frames, `frame-ancestors 'none'`, `base-uri 'none'`.

  Vite's production build has no inline script, and inline assets are off, so no `data:` URL is made.

- **Permissions-Policy** denies the camera, geolocation, microphone, payment, USB and Bluetooth. The app grants itself only `otp-credentials`, so Android can read the login code from its SMS (board A2).
- **HSTS, `nosniff`, `strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`**, and hashed assets cached for a year.
- **`noindex` in every environment:** the app is behind a login, and nothing in it is for a search engine.

**The Worker.** `mm-app` (`apps/app/wrangler.jsonc`) is static assets only, with `not_found_handling: "single-page-application"`, so any page path answers the app:

- **Route:** `<client host>/*` is attached only where the client surface is switched on. Today that is `app-staging.maneman.in/*`, beside mm-api's more specific `/api/*`.
- **Production** has the Worker but no route, and its deploy step does nothing until it is bootstrapped, with the go-ahead.
- **The config check** holds `mm-app` to the same rules as `mm-site`: no bindings, no code, every inheritable key explicit, and the routes exactly those of the switched-on surface (`checkSpaConfig`).
- **The Worker registry** lists it (`kind: "spa"`, `surface: "client"`). The build, the release script and both deploy workflows therefore include it.

**Tested as it will be served.** `scripts/serve-app.ts` serves the build on `app.localhost:4322` with the Worker's own rules:

- index.html for any page path;
- `/api/*` passed to the local mm-api with the browser's own `Host`, as Cloudflare's routing keeps it.

mm-api therefore answers as the client surface, and a write's `Origin` matches the URL mm-api sees. The browser tests run as their own Playwright project at 390 px, under the CSP guard and axe.

## Consequences

- **The first load is 70.9 KB of gzipped JavaScript,** under half the budget, before the screens after login are added.
- **This step builds the shell and board A1 only.** The login (A1–A3), Home, the tabs, Profile (G1–G2), and the manifest and service worker follow below. Their fidelity pairs against the boards follow in P2-F1.5, below.
- **A new Worker's first deploy is a bootstrap** (runbook, step 5): `mm-app-staging` was bootstrapped on 22 September 2026. `mm-app-production` waits for the go-ahead.
- **The static server can now keep the Host header** (`keepHost`). The public site's tests do not use it and are unchanged.

## The login and Home (P2-F1.2)

- **Neutral, as the owner ruled (ADR 0030).** Every number reaches A2. Its line reads "If +91 98xxx x4417 has a booking with us, a code is on its way on WhatsApp", where the design has "Sent on WhatsApp to …". A3 is reached by the client's choice, through a link on A2, and its title becomes a question: "No booking on this number?".
- **The code's boxes are one field.** A single `inputmode="numeric" autocomplete="one-time-code"` input lies unseen over the six boxes, which only draw what is typed.
  - The fifth wrong code voids it, in the design's words ("That code did not match. Two attempts left.").
  - **A wrong code's borders are in the error colour for ink (`--error-on-ink`), not oxblood.** The design asks for oxblood, but `#8A3A2E` on the ink ground is about 2.1:1, under the 3:1 WCAG 2.2 asks of the boundary that shows the error.
  - WebOTP is asked for whenever the code goes by SMS.
  - The resend's countdown is shown, not spoken.
- **Home, for a lead, is board B2.** The consultation's date, window and place come from `GET /api/me`, which gains `place` (the saved address, else the booking's city) and `initials` for the profile button. While self-serve booking is off, Reschedule and Add a note open WhatsApp to ops with a message ready, as the prompt's `409 ops_assisted` fallback would.
- **The tabs.** Visits lists the consultation. Photos, Payments and Refer show the design's empty states. The tab glyphs, from the design's tab bar, are in `apps/app/src/icons.ts`, pinned by `test/node/app-content.test.ts`.
- **Placeholder copy.** `apps/app/src/content.ts` marks the lines the design does not draw: A1's errors, A2's neutral line, the void and failed states, the WhatsApp messages, and Home with nothing booked. Each awaits the owner's wording.
- **Tests log in for real.** Locally only, `OTP_FIXED_CODE` makes every code a known one, so the browser tests go from a booking made through the public API to Home. The guard refuses it in staging and production.

## The profile (P2-F1.3)

- **Boards G1 and G2,** on the profile API (ADR 0042). The design draws no address form, so its fields follow G2's number field. Switching on referral cards first shows the card's four lines (board F3), so the consent recorded is one the client has read.
- **Only the page scrolls.** The header and the tabs sit outside the scrolling page, so nothing passes under them and no focused control can be hidden there (WCAG 2.4.11). Each page opens at its top.

## The PWA and board B3 (P2-F1.4)

- **The manifest and icons are drawn at build time** (`apps/app/pwa.ts`; since 5 October 2026 the build both apps share, `packages/web-kit/pwa.ts`, with the app's identity in `apps/app/pwa.ts`), from the brand kit: the favicon drawing on ink, as the kit's README asks for home-screen icons, at 192 and 512 px, a maskable 512 with the crown inside the circle a launcher may crop to, and the 180 px Apple touch icon. Install prompts are left to the browser.
- **The service worker is hand-written** (`apps/app/sw/sw.ts`), a second Vite entry served as `/sw.js`, so its scope is the whole app. The build writes in the list of files it keeps and a version, a hash of those files, so a new build installs afresh and drops the old files.
  - **Pages** come from the kept app first, without waiting on the network (since 25 September 2026; until then from the network first, which a signal that never answers held closed for minutes). A new build still arrives: the browser checks `sw.js` each time the app opens.
  - **The app's own files** come from what it kept at install. The fonts it never draws with, the extended Latin subsets and the rupee, are not kept.
  - **`GET /api/me`, Home's data,** comes from the network and is kept. With no network, or none that answers within 3 seconds, the kept copy is answered, marked `Mm-Served-From: cache`, and the app shows B3's offline banner over it and keeps asking. Booking and rescheduling are disabled until the connection is back. Which request the worker answers, and how, is a table of its own (`apps/app/sw/requests.ts`), with a test.
  - **No other API answer is kept,** so no photograph or document ever is.
- **The kept Home is the one personal thing on the phone.** The app deletes it at logout and whenever the API says the session has ended, from any call on any page (see the update below), rather than leaving it to the service worker, which does not see a page loaded around it (a hard reload).
- **Back online, Home is fetched again,** tried a few times over some seconds, since a connection is often not usable the moment the phone reports it.
- **Installed on an iPhone the app runs to the bottom edge** (`viewport-fit=cover`), so the tab bar and the login pad for the home indicator.
- **Board B3's three states.** Loading is the design's two blocks, used while the profile loads. Offline is the ink banner, shown for a kept Home and whenever the connection drops. The error is the design's, with Try again and Message us.
  - **The error leaves out the design's "Your visit is still booked."** When the app cannot reach the API it cannot know that there is a visit. The line returns with Home's own visit data (P2-F2).
- **Tests.** The app's browser tests block service workers, since one would answer requests a test fakes; `e2e/app/pwa.e2e.ts` allows them and covers installability (Chrome's own check), the offline Home, the kept files, and logout. The JavaScript budget counts the service worker: 79.8 KB gzipped in all.

## Fidelity pairs (P2-F1.5)

- **`npm run fidelity:app` pairs each frame P2-F1 builds with the app in the same state** (`scripts/fidelity-app.ts`, method in `docs/fidelity-method.md`). The API is answered with the design's own example, so no mm-api is needed. The Phase 1 harness now shares its library routing and pairing (`scripts/lib/fidelity.ts`), and its screenshots are unchanged.
- **Defects the pairs found, now fixed:**
  - the tab bar scrolled away on a long page (fixed in P2-F1.4);
  - A2's automatic-reading line used the WhatsApp glyph where the design draws its bubble alone;
  - A2's countdown kept a paragraph's default margins;
  - A3's box kept 20 px above its line, where the design keeps 30;
  - the profile's page started 28 px below its header, where G1 has 24.
- **The known differences that stand** are listed in `docs/fidelity-method.md`. One was the owner's to rule: the profile shows the whole address, where the design shows only the area. They ruled on 22 September 2026 to keep the whole address (ADR 0025, item 23).

## The read surfaces (P2-F2)

The fitted client's screens over the mirrors (P2-M2): Home B1, Visits C1 and C9, Photos D1 to D3, and Payments E1 to E3.

- **Pages have paths.** `/visits/:id` (C9), `/photos/compare` (D2) and `/payments/:id` (E2) join the tabs (`apps/app/src/route.ts`). Each page is keyed by its path, so it opens at its top and fetches its own data; nothing but Home is kept on the phone.
- **Each page draws its own header, as its board does.** Home keeps the mark and the profile button; Visits, Photos and Payments put their title in the header; C9, E2 and the profile have a way back and the page's title, which is the page's heading. Each page pads itself, since the boards differ (Home 28 px down, C1 22, E1 none). A page fades in over 300 ms on the one curve, and never slides; under `prefers-reduced-motion` nothing moves.
- **Home picks its board from the next visit.** A consultation is B2, with what to expect; any other visit is B1, with its technician's initials and first name. A Phase 1 booking not yet in FSM is still B2. A fitted client with nothing booked gets a placeholder line and "Book your next visit". B1's credit tile and prompt followed on 25 September 2026 (below).
- **The C-sheets' WhatsApp fallback: the one sanctioned deviation.** While `SELF_SERVE_BOOKING` is off (docs/prompts/phase2-frontend.md, "C. Visits"), "Book your next visit", "Reschedule" and "Add a note" open WhatsApp to ops with a message ready that names the visit by its kind and date, as the API's `409 ops_assisted` would send the client there anyway. Offline, Book and Reschedule are disabled; the note still opens WhatsApp, which keeps it until the phone is back online. Cancel has no button on the read surfaces. The sheets themselves (C2 to C8) arrive with P2-F5.
- **Photographs.** Each visit shows one row of five angles in the design's order (front, top, left, right, hair) at 3:4, the photographs after the visit, or before it when none were taken after; an angle not taken stays a blank block. No captions; each carries an alternative text for screen readers. Each fades in over its loading block as it arrives, with no spinner (D3). Tapped, a photograph opens in a sheet, large, above D3's download line: on an iPhone Download opens the share sheet, whose "Save Image" puts it in Photos; elsewhere it downloads, and the gallery lists it. Links last 15 minutes (ADR 0032); the page asks for fresh ones each time it opens.
- **Compare (D2).** The earlier visit shows left of a divider that follows the finger with no easing and no snap. It is a slider for the keyboard and screen readers: arrows move it 2%, Page Up and Down 10%, Home and End to the edges. The three angles are D2's, Front, Top and Hairline, the last being the hair angle; changing the angle cross-fades both sides together, and the other angles of both visits load in advance. It opens on the first visit with photographs against the latest; the pickers are native selects under the design's boxes.
- **Payments.** One list of payments and refunds, newest first (the API's entries, P2-M2.6). The ex-GST figure leads, with the inclusive amount beneath or beside it; both come from the API, never from the app. A payment's page lists its tax invoice, which opens Books' PDF, and its receipt; a refund's lists its voucher and where the money goes back to. A document not yet raised says so (E3) with Notify me, which asks ops on WhatsApp until the app can tell the client itself. Receipts and vouchers are never ready on staging: they wait for the invoicing route (`docs/open-points.md`, item 9). Charges arrive with booking (P2-M5), and credits with P2-M3.
- **B3's error says "Your visit is still booked."** when the Home the phone kept has a visit on it.
- **Browser tests read a fitted client seeded before they run** (`e2e/global-setup.ts`, `e2e/app/fitted.ts`): the local FSM is a stub with nothing in it, so the client is written straight into the local database and photograph bucket, as the mirrors would hold it. It is seeded once, before any test, because wrangler writing to the local database while the local mm-api does meets it on SQLite's lock, and the API's own requests fail. The tests share the client and only read it; the local mm-api lets one number have as many codes as the tests need.

## Booking in the app (P2-F5)

Boards C2 to C6, over self-serve booking (ADR 0045), on staging ahead of the rest of P2-M5 at the owner's request.

- **Where it opens.** "Book your next visit" (Home and Visits), "Book your first fit" after a consultation, and "Book a free consultation". `GET /api/me` says whether self-serve booking is on and what the client may book. On, the button opens the booking sheet; off, it opens WhatsApp to ops, as before; offline, it waits. Reschedule and cancel stay on WhatsApp until their boards (C7, C8) arrive.
- **The sheet** rises over the ink-night ground: the date (C2), fourteen days with full ones shown and not chosen; the window (C3), with whether the regular technician is free; then paying (C4, and C5's first fit, with its guarantee and late-fee lines). The hold counts down in whole seconds, not read aloud each second, and lapses to C6's "That slot has gone back". Closed before paying, the hold is let go.
- **Paying is Razorpay Checkout,** loaded from `checkout.razorpay.com` when a client first pays, on the order our API made, with the client's chosen method first. Checkout's own retry is off, so a failed payment comes back to C6's screen with the hold still counting, "Try again" and "Another method". Paid, the sheet polls the hold every two seconds for a minute: booked shows C6's confirmation; refunded, or slow, says so.
- **The policy** (`apps/app/headers.ts`) allows Checkout's script, its frames from `api.razorpay.com`, calls to it and its logger, and popups: the opener policy is `same-origin-allow-popups`, since a card's check can open one. **Changed 2 October 2026:** it also allows the risk-detection script Checkout loads from `cdn.razorpay.com`, which Razorpay's fraud checks rely on and which the policy had refused on every Checkout opened; Checkout's two other logging hosts; and inline styles, since Checkout writes a style element and a style attribute into the page that change with Razorpay's releases, so no hash would hold. Inline scripts stay refused. `e2e/app/checkout-policy.e2e.ts` loads and opens the real Checkout and fails on anything the policy refuses.
- **Browser tests** replace Checkout's script with one that pays or fails at once, and answer the hold's poll as Razorpay's webhook and FSM would leave it, since neither reaches a local run. The booking tests share the one fitted client and run one after another, since a client has one hold at a time.

## Refer (P2-F3)

Boards F1 to F6, on the Refer tab (`apps/app/src/refer/`), against `GET /api/refer` (ADR 0048).

- **F1** shows what a referral earns, the credit tile while there is a balance, and the two ways on: sharing, and who has been fitted.
- **F2 to F4 are one sheet.** Which card, then the consent its own photographs need (the notice's own lines, F3), then the preview exactly as the friend receives it, with WhatsApp, other apps and copy. (Amended 27 September 2026: where the phone can share files, WhatsApp and other apps send the card itself, as a photograph captioned with the invite, so the preview is what the friend receives only where the phone cannot; a client's own card is read from `GET /api/refer/card`, since the preview's route answers only on the public host. ADR 0048, amended that day.)
  - **The card is composed on the phone** (`refer/card.ts`), from the first fit's front photographs, before on the left and after on the right, with the gilt rule between: same crop, no name, no words. It is sent to the API only when the client chooses their own. (Since 25 September 2026 it is composed in a Worker, to board A1: see below.)
  - Choosing the example takes any card of theirs down.
  - If the photographs cannot be read, or the API refuses the card, the sheet falls back to the house example and says so.
- **F5 and F6** are `/refer/fitted`: completed fits only, each a first name and a month, with what was earned and what is left; the empty state; and the revoke of their own card.
- **What the referrer never sees:** opens, consultations, or a friend who has not been fitted. Ops see those figures instead (ADR 0048).

## Update of 25 September 2026: sessions, the hold, and the app by keyboard

The audit of 24 September found the client stuck, or misled, in places this ADR said were handled. What is true now:

- **A session that ends mid-use goes back to the login.** Only `GET /api/me` at start acted on a 401; every other page met it as a load that failed, and offered Try again for ever, with the kept Home still on the phone. Now `apps/app/src/api.ts` tells App of a 401 from any call, as the technician app's does (ADR 0053), and App forgets the kept Home and shows the login on the same page, with one line saying the session ended. The path is kept, so logging in again returns to it.
- **Logging out takes the API's word for it.** It forgot Home and showed the login whatever the API said, so a logout with no signal left the session alive, and the next open on a shared phone was signed in. The button now waits for a connection, and a logout the API does not answer says so and leaves the client where they were.
- **An answer that is not JSON counts as no connection**, where it left a page loading for ever; **a page that throws** shows "This page did not open" with Reload and Home, not a blank screen (`states/ErrorBoundary.tsx`, one round each page and one round App); **a path such as `/constructor`** opens Home.
- **The hold is counted on the API's clock.** It was counted on the phone's, so a phone 3 minutes fast read "6:59", and one 11 minutes fast said the slot had gone at once and never let the hold go. Every fresh answer's `Date` header sets the difference (`lib/clock.ts`), and when the phone sees the hold lapse it lets it go itself. A deadline, not a count from when the page learnt of it, drives every countdown (`lib/useSecondsLeft.ts`).
- **Checkout loads as the pay step opens**, and the sheet stays up, busy, until it has; a script that has not come in 15 seconds is C6's payment failed, with the hold still counting. The sheet's close event, which can land after it has risen again from under Checkout, no longer lets the hold go.
- **Money.** A visit a credit covers is confirmed as "1 visit credit used · N remaining", never as a payment. A late fee reads the same on C4, C5 and C7, the ex-GST figure with the inclusive one muted after it once GST applies (`lib/money.ts`). Home is fetched again whenever money has moved, not only once a booking is confirmed.
- **The reminder and the tier** are ADR 0025, items 37 and 35: the sheet asks for the day-before reminder when it is off and promises it only when it is on, and books the standard tier, with premium on WhatsApp.
- **By keyboard and screen reader.** Each page and login screen names itself in the browser's title, and its heading takes the focus the tap that changed it left on nothing, as each sheet's step does. The date strip, the windows and the ways to pay are each one group of native radio buttons: one tab stop, arrow keys between. Every step of the sheets has a heading that names the sheet. The hold's count is outside C6's alert, which a screen reader would otherwise read again every second; a minute before it lapses, and when a new code can be asked for, a status says so once. "Read automatically" is shown only for a code sent by SMS, the one WebOTP reads.
- **One focus rule, one motion rule, one heading weight** in `styles/global.css`, as the public site has: a ring in ink on paper and paper on ink; nothing moves under reduced motion, the share sheet included; headings in the serif's one loaded weight. The departures from the boards this takes are ADR 0025, item 36: fields and switches edged at 3:1, Close standing visible above a sheet, and full targets.
- **The frame runs to the edges** of a 414 or 430 px phone: the column fills it, so the header's rule, the offline banner, the footer, the tab bar and every sheet meet the screen's edges.
- **Tests.** `e2e/app/` covers each of these, and `test/node/app-*.test.ts` the calls, the routes, the money line and the service worker's table.

## Second update of 25 September 2026: the client's screens say what happened and what comes next

The audit of 24 September found Home going quiet while a visit was still open, the Refer boards and the card half built, and privacy actions that failed without a word. What is true now:

- **A visit stays the client's until FSM closes it.** `GET /api/visits` and `GET /api/me` kept a visit only while its window had not ended, so a visit FSM had not yet closed vanished from both, Home said nothing was booked and offered the booking again. Every visit FSM has not closed now stays under upcoming with a `stage`: booked, in progress in its window, or being closed after it. Home prefers a visit still to come; a visit that has begun reads "Today · in progress" or "Being closed", has no Reschedule, and Visits offers no booking while it is on Home.
- **Home is B1 whole.** The credit tile, from the balance `/api/me` already carried, and one prompt (`src/domain/home-prompt.ts`, one statement): no address while something is booked, the replacement's month, an invoice issued in the last fortnight (ADR 0025, item 44; ADR 0059, amended). A lead with no address sees the first beneath B2's steps.
- **Visits.** Each upcoming visit opens its own page, with Home's card and its ways to change it (`home/VisitCard.tsx`), and C1's Prepaid marks one paid for ahead or covered by a credit. A past visit says what was done: the checklist its technician ticked. A visit or payment that is not the client's says it could not be found (`states/NotFound.tsx`).
- **Documents speak of time.** An invoice still missing a day after its visit is late, with a message ready; one for a visit not yet done is raised once it is; a charge and a late fee offer the receipt alone; a refund past ten days says it is late.
- **Refer is F1 to F6 as drawn.** F2 draws both cards with their boxes, and their own opens F3 until the cards' current lines are agreed to (`GET /api/refer` now says so, and whether the invite names them). F4 is the chat's bubble on the dark ground, in WhatsApp's own colours (`--wa-*`, ADR 0037 amended), with the card itself, the landing's own title and line (held to `site/src/content/referral.ts` by `test/node/app-invite-preview.test.ts`), and the three ways to share; one that fails is F6's "Share failed". F5 has its two figures, and F6's empty tracker offers the invite. A client not yet fitted sees Refer's empty state, as B2 says.
- **The card is composed in a Worker** (`refer/compose.worker.ts`, OffscreenCanvas), to board A1: a 2 px gilt rule and the mark and wordmark in the corner, from `refer/card-layout.ts`, which `scripts/make-house-card.ts` draws the house card from as well, into the site and the app. Its colours are read from the brand's tokens. The card is made before the consent is recorded, then stored; a phone without OffscreenCanvas falls back to the house example and says so.
- **Privacy actions wait for the API's word.** A consent switch, the card's revoke, the example taking a card down and a deletion request each say so when the API does not answer, and change nothing on the screen until it does. A number change waiting for us can be withdrawn (`DELETE /api/number-change`).
- **The address form** marks its required fields; one left out is marked, named by the error and given the focus; the form closes on its heading. The building search asks by `POST`, so a link from another site cannot spend Google's budget.
- **Thumbnails** load as they near the screen and say their size. They are still the whole photograph: no smaller copy exists yet (`docs/open-points.md`, item 66).
- **Focus.** The screens' own rings gave way to the one in `styles/global.css`; an ink block sets `--focus-colour`. Kept: a field's inset edge on focus, the compare's picker (its select is unseen) and the payments list's inset ring at the page's top edge.
- **Tests.** `test/worker/client-visits.test.ts`, `client-profile.test.ts` and `referrals.test.ts` cover the API's side; `test/node/app-referral-card.test.ts` holds the card and the house card to board A1, and `app-documents.test.ts` the documents' lines; `e2e/app/` the screens.
