# Getting started: the whole system on your laptop

Everything runs locally with stub providers: no Zoho, no Razorpay, no WhatsApp and no Google, and nothing leaves the machine. You need Node 24.11 or later (`.nvmrc`) and Chrome or Firefox, which resolve `app.localhost` and the other `*.localhost` hosts on their own.

```sh
npm ci
npm run db:seed:local   # clients, visits and a technician to sign in as; prints their numbers
npm run dev:all         # the whole stack; Ctrl+C stops it
```

`dev:all` (scripts/dev-all.ts) creates `.dev.vars`, migrates and marks the local database, builds the public site once if it has never been built, then starts:

| What           | Where                      | Notes                                                               |
| -------------- | -------------------------- | ------------------------------------------------------------------- |
| Public site    | http://localhost:4321      | the built site, as its Worker's assets serve it; `/api/*` to mm-api |
| Client app     | http://app.localhost:4322  | Vite, with hot reload                                               |
| Ops console    | http://ops.localhost:4323  | signed in as `ops@localhost`: Access is a stub                      |
| Technician app | http://tech.localhost:4324 | Vite, with hot reload                                               |
| mm-api         | http://127.0.0.1:8787      | `wrangler dev`, with the local vars below                           |

Each app must be opened on its own host: mm-api tells the client app, the console and the technician app apart by the host a request comes on (docs/decisions/0026-hosts-and-surfaces.md), so `localhost:4322` would reach the public site's routes and answer 404.

**Every login code is `246810`**, for clients and technicians alike. mm-api runs with it (`OTP_FIXED_CODE`) and with the rate limits raised, as the browser tests do: both read `scripts/lib/local-stack.ts`. The guard refuses the fixed code anywhere but locally.

After changing the public site, rebuild it with `npm run build:site -- --env local`; `npm run dev:site` is the Astro dev server on its own, without `/api/*`.

## What stands in for what

Locally nothing happens by itself that, on staging, another system does. Each has a command:

| On staging                                        | Locally                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| The cron, every five minutes                      | `npm run tick`: one run of every job (`wrangler dev --test-scheduled`)                         |
| Razorpay's webhook after a client pays            | `npm run pay:local`: pays the last booking held, by the same signed webhook                    |
| FSM closing a visit once its technician closes it | `npm run close:local`: lists open visits; `npm run close:local -- <id> [--partial]` closes one |
| WhatsApp messages, login codes                    | the stub: nothing is sent, and every code is `246810`                                          |
| The address search (Google)                       | the stub: a few made-up suggestions                                                            |

`close:local` calls `POST /api/dev/appointments/:id/close`, which exists only where `DEV_ROUTES=on`. `dev:all` sets it; the startup guard refuses it anywhere but locally, so it can never be reached on a deployed Worker.

The FSM reconciliation does not run locally: the stub keeps no record of any visit, and the repair would take every visit it read for one FSM had deleted.

## The story, end to end

1. **Book.** On the site, book a free consultation at `/book` with any made-up number; or sign in to the client app as a seeded client (`db:seed:local` prints three).
2. **Pay for a visit.** In the client app, as the fitted client, book a service visit. A client with no address is asked for one first; save it in Profile, or the booking waits for it. At _Pay and confirm_, Razorpay's Checkout cannot take a payment locally (the stub has no key): close Checkout's window but leave the booking sheet open, since closing the sheet lets the hold go, and run `npm run pay:local` within the hold's ten minutes. The visit is booked within a few seconds, through the same queue as on staging, and Visits shows it.
3. **Do the job.** Sign in to the technician app as the seeded technician (`98100 99001`): his jobs today are at a client's address with no coordinates, so _I have arrived_ passes wherever the laptop is.
4. **Close it.** `npm run close:local` lists the open visits; close one as FSM would once its technician closes it.
5. **What follows.** `npm run tick` runs the cron: invoices for closed visits, referral grants after a first fit, reminders and the rest.
6. **Share.** An invite from Refer links to `http://localhost:4321/r/<code>`, which the local site answers.

`npm run db:seed:local` again gives a fresh set: the technician and his client are the same every time, and their earlier jobs are cancelled. Seed with mm-api idle or stopped: wrangler writing to the local database while mm-api does meets it on SQLite's lock.

## Ports

A port another program holds can be moved with its variable, for `dev:all` and the browser tests alike:

```sh
MM_API_PORT=8797 MM_INSPECTOR_PORT=9240 npm run dev:all
```

The variables are `MM_API_PORT` (8787), `MM_INSPECTOR_PORT` (9230), `MM_SITE_PORT` (4321), `MM_APP_PORT` (4322), `MM_OPS_PORT` (4323) and `MM_TECH_PORT` (4324). Links the Worker writes into messages and alerts name the default site and console ports (`src/config/environments.ts`), so with other ports those links need the port changed by hand.

## Tests

```sh
npm test                 # the Worker tests in workerd and the script tests in Node, about five minutes
npm run test:e2e         # the browser tests; build each surface first: npm run build:<site|app|ops|tech> -- --env local
```

The browser tests start their own servers on the same ports, and reuse ones already running, so stop `dev:all` first unless you mean them to share it. The ops and technician tests answer the API in the browser; every answer they fake is checked against `docs/openapi-ops.json` or `docs/openapi-tech.json` as it is sent (`e2e/contract.ts`), so after changing a route run `npm run openapi` and fix any fake the tests then name.

### A test run that stops

If no test reports for three minutes while a file is still open, the run stops with _No test has reported for 3 minutes, and these files never said they had finished_, naming them (`test/stalled-files.ts`). Vitest has no timeout of its own for this. The one cause found so far was a queue consumer the test runtime ran after its test had ended, whose logs broke the pool's channel; the tests' queues now reach no consumer (`vitest.config.ts`). If it happens again, look in the named file for work a test starts and does not await: a queue send to a real binding, a `waitUntil`, a timer.

## Troubleshooting

- **The webhook answers 404, or `pay:local` says the secret is empty.** A `.dev.vars` made before the local webhook secret existed has it empty. `node scripts/ensure-dev-vars.ts` (which `dev:all` runs) fills it from `.dev.vars.example`; restart `dev:all`.
- **An app answers 404 for every call.** It was opened on `localhost` rather than its own host.
- **`wrangler d1 execute` fails with a lock.** Stop `dev:all`, or wait until mm-api is idle, and run the seed again.
