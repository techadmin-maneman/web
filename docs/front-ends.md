# The front ends

Four front ends, each served by a Worker of its own, each calling mm-api on its own host. This is the guide to all four and to what they share. The public site has a guide of its own, `docs/frontend.md`, for its content, prices, notices and going live.

|                     | Public site                       | Client app                             | Ops console                         | Technician app                                           |
| ------------------- | --------------------------------- | -------------------------------------- | ----------------------------------- | -------------------------------------------------------- |
| Worker              | `mm-site`                         | `mm-app`                               | `mm-ops`                            | `mm-tech`                                                |
| Code                | `site/`                           | `apps/app/`                            | `apps/ops/`                         | `apps/tech/`                                             |
| Built with          | Astro, with Preact islands        | React 19 and Vite                      | React 19 and Vite                   | React 19 and Vite                                        |
| Staging             | `staging.maneman.in`              | `app-staging.maneman.in`               | `ops-staging.maneman.in`            | `tech-staging.maneman.in`                                |
| Production          | `maneman.in`                      | `app.maneman.in`                       | `ops.maneman.in`                    | `tech.maneman.in`                                        |
| Locally (`dev:all`) | `http://localhost:4321`           | `http://app.localhost:4322`            | `http://ops.localhost:4323`         | `http://tech.localhost:4324`                             |
| Who signs in        | Nobody                            | Clients: their number, a WhatsApp code | Staff, through Cloudflare Access    | Technicians: their number, a WhatsApp code, on one phone |
| Its API             | `docs/openapi.json`               | `docs/openapi-client.json`             | `docs/openapi-ops.json`             | `docs/openapi-tech.json`                                 |
| Its design          | `design/Mane Man Site v2.dc.html` | `design/phase2/Client App.dc.html`     | `design/phase2/Ops Console.dc.html` | `design/phase2/Technician App.dc.html`                   |

Staging's hosts are all behind Cloudflare Access. In production, `maneman.in` serves a placeholder page and the three apps are not yet switched on; both wait for the owner's go-ahead (`docs/runbook.md`, "Where things stand").

## How a front end reaches the API

- **On its own host.** Cloudflare sends `<host>/api/*` to mm-api and everything else on the host to the front end's Worker, since mm-api's route is the more specific. mm-api answers each host with its own surface's routes, and a route asked for on another host is a 404 (ADR 0026). Locally, the Vite dev servers and `scripts/dev/serve-*.ts` pass `/api/*` to mm-api and keep the host, as Cloudflare does, which is why each app must be opened on its own `*.localhost` host.
- **Through one client.** `packages/web-kit/api.ts` is the only API client (ADR 0076). Each app makes its own from its surface's document in `src/api.ts`, so every path, query, body, answer and error code is checked against the API as it is. An answer is a success with its body, a refusal with the API's code and the fields it names, or "offline" for a call that never reached the API. A test fails any app that calls `/api/` another way (`test/node/dom/ui-package.test.ts`). The public site keeps its few calls in `site/src/lib/api.ts`.
- **With types written from the API.** `npm run openapi` writes each front end's `api-schema.ts` from the zod schemas that serve the routes. Never edit one by hand: change the route, run `npm run openapi`, and the compiler shows every screen the change reaches.
- **Signed in by cookie, or by Access.** A client's or a technician's session is an HttpOnly cookie mm-api sets; the app holds no token, and any 401 ends the session wherever the person is. The console has no login of its own: Cloudflare Access decides who reaches the host, mm-api checks Access's token on every call and audits it (ADR 0031), and a call Access turned away reads as `signed_out`. Locally Access is a stub, and the console is signed in as `ops@localhost`.
- **From the same origin.** mm-api refuses a write to a Phase 2 surface whose `Origin` is not its own host. The public site's forms carry a Turnstile token instead (`docs/turnstile.md`).

## What they share

| Package            | What it holds                                                                                                                                                                               | Used by                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `packages/brand`   | Every colour, size, space, weight, leading and motion as tokens; the fonts; the icons and the marks (`packages/brand/README.md`, ADR 0077)                                                  | All four                                               |
| `packages/ui`      | The React components and hooks the apps draw alike: buttons, sheets, dialogs, fields, tables, tabs, page states, the router, `useLoad`, `useOneAtATime` (`packages/ui/README.md`, ADR 0076) | The three apps                                         |
| `packages/web-kit` | The API client, the apps' security headers, India's dates, rupees, a mobile number as typed, and WhatsApp's number and links                                                                | The three apps, and the site's dates, rupees and links |

- **Tokens only.** No stylesheet writes a colour, length, duration, curve, weight or leading of its own; `test/node/site-tokens.test.ts` and `test/node/app-tokens.test.ts` fail on one.
- **No copies.** An app that keeps its own icon, mark, router, loader, tap guard or error boundary, hides words its own way, formats rupees or adds India's offset fails a test. What is shared is written once, so a fix reaches every app.
- **Each app brings its own React.** `packages/ui` imports React without installing it, and each app's `vite.config.ts` dedupes it: the repository's own React 18 is there for the fidelity runs.

## Inside an app

The three apps are laid out alike:

| Where                             | What                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `index.html`, `src/main.tsx`      | The page and its entry                                                                                            |
| `src/App.tsx`                     | What shows, by session and by path                                                                                |
| `src/route.ts`                    | Every page by path; the router itself is `@maneman/ui/router`                                                     |
| `src/api.ts`, `src/api-schema.ts` | The calls, and the types `npm run openapi` writes                                                                 |
| `src/content.ts`                  | Every word the app shows. A line the owner has not given yet is marked `PLACEHOLDER`                              |
| `src/<screen>/`                   | A folder per screen or tab: its components and its CSS module                                                     |
| `src/states/`, `src/styles/`      | Loading, failure and not-found; the app's own global styles                                                       |
| `headers.ts`                      | The app's content security policy and permissions, which the build writes into `_headers`                         |
| `vite.config.ts`                  | The build, one per environment into `dist/<env>`, and the dev server's `/api` proxy                               |
| `wrangler.jsonc`                  | The Worker: static assets, every path that is not a file answered with the app, and its route in each environment |
| `sw/`, with `pwa.ts`              | The service worker, and the app's identity on a home screen (client and technician apps)                          |

A screen that chooses between several things says so in a function that returns early, not in nested ternaries; ESLint holds `apps/`, `packages/` and `site/src/` to it.

## The client app

What a client does after booking: Home, Visits, Photos, Payments, Refer and Profile (ADR 0043). Only a person with a consultation booked, or a visit since, can sign in (`src/domain/login.ts`).

- **Booking and paying.** A visit is held for ten minutes while the client pays through Razorpay's Checkout, whose hosts the app's policy allows (`apps/app/headers.ts`). The visit is booked once Razorpay's webhook says the money came, in that request (ADR 0110). Where `SELF_SERVE_BOOKING` is off, the API answers `ops_assisted` and the app says booking goes through ops.
- **Installable, and open offline.** `packages/web-kit/pwa.ts` draws the manifest and icons from the brand kit, with the app's names in `apps/app/pwa.ts`; `apps/app/sw/sw.ts` keeps the app's files and the last Home it was sent, which Home shows offline (board B3).
- **Its budget.** A build over 150 KB of gzipped JavaScript fails (`scripts/lib/spa-build.ts`), and Lighthouse holds its first screen to the budgets in `scripts/ci/lighthouse.ts`.

## The ops console

Ops' desk tool, drawn at 1440 px: dispatch, clients, no-shows, referrals, the waitlist, tasks, technicians, grievances, deletion requests, number changes and settings (`apps/ops/src/route.ts`). Every call is audited under the Access identity behind it (ADR 0031). Prices, rules and the service area are set in Settings, not in a release (ADR 0061), and a setting says what it will change before it is saved (ADR 0071). The console registers no service worker.

## The technician app

What a technician needs at a client's door, in a basement, with gloves on (ADR 0053):

- **Today's and tomorrow's jobs**, one job's card, and its steps: before photographs, checklist, consumables, the piece (a first fit's and a replacement's), after photographs and the outcome, with the client's hair profile on a consultation and a one visit (`apps/tech/src/route.ts`).
- **An outbox.** Every step goes into IndexedDB (`mm-tech`, `apps/tech/src/store/`) and is sent one at a time, oldest first, whenever the phone has signal. "Waiting to reach us" (`/waiting`) shows what is still on the phone. Signing out, or ops revoking the phone, wipes the database whole.
- **One phone per session.** The phone enrols itself when he signs in, and ops can revoke it from the console (ADR 0052).
- **Photographs that never touch the gallery,** taken through `getUserMedia` into a canvas and re-encoded to 250 KB or less (`apps/tech/src/camera/`).
- **Any phone, iPhones included.** On an iPhone the store is kept only when the app is on the home screen, so the app is installable (`apps/tech/pwa.ts`), and says so when the phone has not promised to keep its store.

`docs/tech-field-test.md` is what only a real phone can prove, and `docs/technician-test-setup.md` is how to sign in on your own.

## The public site

The site is an Astro build of `design/Mane Man Site v2.dc.html`, served as static assets by mm-site. Its Worker answers first only on `/`, `/book` and `/r/*`: it writes the price book's figures into the pages and answers an invite's landing (ADRs 0027 and 0073). The try-on and the booking form are Preact islands in `site/src/islands/`. It uses the brand's tokens and `packages/web-kit`'s dates, rupees and links, but not `packages/ui`. Everything else about it is in `docs/frontend.md`.

## Running them

```sh
npm run dev:all                   # everything, with hot reload for the three apps (docs/getting-started.md)
npm run build:app -- --env local  # or build:site, build:ops, build:tech; --env staging or production
```

To work on one app alone, run mm-api with `npm run dev` and the app with `npm run dev:app` (or `dev:ops`, `dev:tech`), and open it on its own host: `http://app.localhost:5173`, `http://ops.localhost:5174` or `http://tech.localhost:5175`. On plain `localhost` every call answers 404.

## Testing them

- **Unit tests** in `test/node/`: `app-*`, `ops-*`, `tech-*`, `ui-*`, `web-kit-*` and `site-*`, with the token and no-copies tests above. They run in `npm test`.
- **Browser tests** in `e2e/`, one Playwright project each: the site at 390 and 1440 px, `app` at 390, `ops` at 1440, `tech` at 390, `tech-ios`, the technician app on WebKit, and `tech-live`, one technician's day against the local mm-api with nothing faked. Build each surface for `local` first; `e2e/global-setup.ts` refuses a stale build. The client app's tests drive the local mm-api, and fake an answer only for a state the local stack cannot reach, such as a payment through Checkout. The console's and the technician app's answer the API in the browser. Every JSON answer any page gets, faked or the local mm-api's, is checked against its surface's OpenAPI document (`e2e/support.ts`, `e2e/contract.ts`, ADR 0075). The screens are checked with axe as they go.
- **Fidelity pairs.** `npm run fidelity:app`, `fidelity:ops` and `fidelity:tech` (and `fidelity`, `fidelity:refer` for the site) shoot each screen beside its board into `docs/fidelity/`. A difference in type, spacing, colour or order is a defect (`docs/fidelity-method.md`).

## Deploying them

A merge to `main` builds each front end for staging and deploys it with `scripts/release/release.ts ship`. A production release deploys the site, then each app that has a Worker in production, after mm-api. Each app's build writes its Worker, environment and commit into its page (`mm-worker`, `mm-environment`, `mm-version`; the site's pages carry the first two), and the smoke tests require each Phase 2 host to serve its own app, built from the commit just deployed: a blank or stale app fails the deploy (ADR 0006).

A production build refuses copy still marked `PLACEHOLDER` in an app's `content.ts`, or in the referral landing's (`scripts/lib/content-gate.ts`); staging ships it by the owner's ruling (ADR 0025, item 27). `npm run build` passes `--allow-placeholders` only to prove production bundles, and ships nothing.

## Adding a screen or a call

1. Declare the route's request and answer in zod, in `src/routes/`, then run `npm run openapi`.
2. Call it through the app's client in `src/api.ts`.
3. Put its words in `content.ts`, its values in tokens, and its parts from `@maneman/ui`. A value no board draws goes in `packages/brand/tokens.css`, with why, and a departure from a board is recorded in ADR 0025.
4. Test it: its logic in `test/node/`, the screen in `e2e/<app>/`. In the console and the technician app, a new fake is typed with `satisfies` against the app's types, and the contract check holds it to the document.
5. Shoot its fidelity pair against its board.
