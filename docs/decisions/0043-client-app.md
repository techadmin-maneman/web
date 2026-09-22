# 0043. The client app: build, Worker and policy

- Status: accepted
- Date: 2026-09-22

## Context

The Phase 2 front-end prompt sets the client app's stack and bars:

- **Stack:** "React with Vite, as a single-page PWA … TypeScript strict. No UI framework", on `app.maneman.in` as the Worker `mm-app` with static assets.
- **Performance:** a first load under 150 KB of gzipped JavaScript.
- **Security:** a content security policy of its own, allowing the backend (and Razorpay's hosts, once payment arrives), and no analytics but Cloudflare Web Analytics.
- **Layout:** the design is drawn at 390 px, and wider screens centre that column.

The API it calls is mm-api's client surface on the same host (ADR 0026). Only the public site and the staging surfaces are live.

## Decision

**A workspace of its own.** `apps/app` is an npm workspace (ADR 0037):

- **React 19.3 is pinned inside it.** React 18.3.1 stays at the repository root, where the fidelity harness renders the design with it.
- **Vite 8.3 builds it.** Astro already brought Vite 8.3 into the repository.
- **Styles are CSS modules on the brand's tokens** (`packages/brand`). `test/node/app-tokens.test.ts` refuses a raw colour or size, an undefined token, and an inline `style`, which the policy would block anyway.
- **Every word is in `apps/app/src/content.ts`,** from the design.

**One build per environment.** `npm run build:app -- --env <env>` writes `apps/app/dist/<env>` (`scripts/build-app.ts`), with a `_headers` file from `packages/web-kit`:

- **The content security policy:**
  - `default-src 'none'`;
  - scripts, styles, fonts, images, the manifest, workers and API calls from the app's own origin only;
  - no inline code of any kind;
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

- **The manifest and icons are drawn at build time** (`apps/app/pwa.ts`), from the brand kit: the favicon drawing on ink, as the kit's README asks for home-screen icons, at 192 and 512 px, a maskable 512 with the crown inside the circle a launcher may crop to, and the 180 px Apple touch icon. Install prompts are left to the browser.
- **The service worker is hand-written** (`apps/app/sw/sw.ts`), a second Vite entry served as `/sw.js`, so its scope is the whole app. The build writes in the list of files it keeps and a version, a hash of those files, so a new build installs afresh and drops the old files.
  - **Pages** come from the network, and offline from the kept app.
  - **The app's own files** come from what it kept at install.
  - **`GET /api/me`, Home's data,** comes from the network and is kept. With no network, the kept copy is answered, marked `Mm-Served-From: cache`, and the app shows B3's offline banner over it. Booking and rescheduling are disabled until the connection is back.
  - **No other API answer is kept,** so no photograph or document ever is.
- **The kept Home is the one personal thing on the phone.** The app deletes it at logout and whenever the API says the session has ended, rather than leaving it to the service worker, which does not see a page loaded around it (a hard reload).
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
- **Home picks its board from the next visit.** A consultation is B2, with what to expect; any other visit is B1, with its technician's initials and first name. A Phase 1 booking not yet in FSM is still B2. A fitted client with nothing booked gets a placeholder line and "Book your next visit". B1's credit tile and prompt arrive with the credits (P2-M3) and the pieces (P2-M4).
- **The C-sheets' WhatsApp fallback: the one sanctioned deviation.** While `SELF_SERVE_BOOKING` is off (docs/prompts/phase2-frontend.md, "C. Visits"), "Book your next visit", "Reschedule" and "Add a note" open WhatsApp to ops with a message ready that names the visit by its kind and date, as the API's `409 ops_assisted` would send the client there anyway. Offline, Book and Reschedule are disabled; the note still opens WhatsApp, which keeps it until the phone is back online. Cancel has no button on the read surfaces. The sheets themselves (C2 to C8) arrive with P2-F5.
- **Photographs.** Each visit shows one row of five angles in the design's order (front, top, left, right, hair) at 3:4, the photographs after the visit, or before it when none were taken after; an angle not taken stays a blank block. No captions; each carries an alternative text for screen readers. Each fades in over its loading block as it arrives, with no spinner (D3). Tapped, a photograph opens in a sheet, large, above D3's download line: on an iPhone Download opens the share sheet, whose "Save Image" puts it in Photos; elsewhere it downloads, and the gallery lists it. Links last 15 minutes (ADR 0032); the page asks for fresh ones each time it opens.
- **Compare (D2).** The earlier visit shows left of a divider that follows the finger with no easing and no snap. It is a slider for the keyboard and screen readers: arrows move it 2%, Page Up and Down 10%, Home and End to the edges. The three angles are D2's, Front, Top and Hairline, the last being the hair angle; changing the angle cross-fades both sides together, and the other angles of both visits load in advance. It opens on the first visit with photographs against the latest; the pickers are native selects under the design's boxes.
- **Payments.** One list of payments and refunds, newest first (the API's entries, P2-M2.6). The ex-GST figure leads, with the inclusive amount beneath or beside it; both come from the API, never from the app. A payment's page lists its tax invoice, which opens Books' PDF, and its receipt; a refund's lists its voucher and where the money goes back to. A document not yet raised says so (E3) with Notify me, which asks ops on WhatsApp until the app can tell the client itself. Receipts and vouchers are never ready on staging: they wait for the invoicing route (`docs/open-points.md`, item 35). Charges arrive with booking (P2-M5), and credits with P2-M3.
- **B3's error says "Your visit is still booked."** when the Home the phone kept has a visit on it.
- **Browser tests read a fitted client seeded before they run** (`e2e/global-setup.ts`, `e2e/app/fitted.ts`): the local FSM is a stub with nothing in it, so the client is written straight into the local database and photograph bucket, as the mirrors would hold it. It is seeded once, before any test, because wrangler writing to the local database while the local mm-api does meets it on SQLite's lock, and the API's own requests fail. The tests share the client and only read it; the local mm-api lets one number have as many codes as the tests need.
