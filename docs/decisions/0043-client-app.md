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
- **This step builds the shell and board A1 only.** The login (A1–A3), Home, the tabs, Profile (G1–G2), and the manifest and service worker follow, each with its fidelity pairs.
- **A new Worker's first deploy is a bootstrap** (runbook, step 5): `mm-app-staging` was bootstrapped on 22 September 2026. `mm-app-production` waits for the go-ahead.
- **The static server can now keep the Host header** (`keepHost`). The public site's tests do not use it and are unchanged.
