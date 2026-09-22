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
- **This step builds the shell and board A1 only.** The login (A1–A3), Home, the tabs, Profile (G1–G2), and the manifest and service worker follow below. Their fidelity pairs against the boards follow in P2-F1.5.
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
- **Board B3's three states.** Loading is the design's two blocks, used while the profile loads. Offline is the ink banner, shown for a kept Home and whenever the connection drops. The error is the design's, with Try again and Message us.
  - **The error leaves out the design's "Your visit is still booked."** When the app cannot reach the API it cannot know that there is a visit. The line returns with Home's own visit data (P2-F2).
- **Tests.** The app's browser tests block service workers, since one would answer requests a test fakes; `e2e/app/pwa.e2e.ts` allows them and covers installability (Chrome's own check), the offline Home, the kept files, and logout. The JavaScript budget counts the service worker: 79.8 KB gzipped in all.
