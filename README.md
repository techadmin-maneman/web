# Mane Man web

Mane Man fits hair systems at the client's home and services them every month. This repository is its web platform: the public site, with a try-on and booking; the client's app; the ops console; and the technician's app. It runs on Cloudflare's free plan, with Zoho (CRM and Books), Razorpay, WhatsApp, Google Maps and AILabTools behind it.

**Where it stands.** Staging runs all of it, on logged placeholders where the owner's inputs are still owed (ADR 0025, item 27). Production runs the Phase 1 API and a placeholder page until the owner's go-ahead; what is owed before then is `docs/open-points.md`. The briefs are in `docs/prompts/`, word for word, and every decision since is an ADR in `docs/decisions/`. ADR 0025 is the register of the owner's rulings and of where the build departs from a brief.

## How it fits together

Five Cloudflare Workers make up each environment, in one account and one zone, `maneman.in`:

| Worker    | Code        | Serves                                                                                                   |
| --------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| `mm-api`  | `src/`      | `/api/*` on every host. Owns the database (D1), the files (R2), the queues, the cron and every secret    |
| `mm-site` | `site/`     | The public site: Astro pages with Preact islands, and a Worker that writes prices and invites into pages |
| `mm-app`  | `apps/app`  | The client app, a React PWA                                                                              |
| `mm-ops`  | `apps/ops`  | The ops console, behind Cloudflare Access                                                                |
| `mm-tech` | `apps/tech` | The technician app, which works offline                                                                  |

```
a request to maneman.in, app.maneman.in, ops.maneman.in or tech.maneman.in
  /api/*          ──►  mm-api  ──►  D1 (the database), R2 (files), three queues, the cron
  anything else   ──►  the host's own front end: mm-site, mm-app, mm-ops or mm-tech

mm-api  ──►  Zoho CRM and Books, Razorpay, Evolution (WhatsApp), Google Maps, AILabTools
```

Staging's hosts are `staging.maneman.in`, `app-staging.maneman.in`, `ops-staging.maneman.in` and `tech-staging.maneman.in`, all behind Cloudflare Access.

What to know before changing anything:

- **Each app calls the API on its own host.** mm-api tells the four surfaces apart by the host a request comes on, and answers each with its own routes (ADR 0026). So the client app's routes answer only on the client app's host.
- **D1 first, the vendors after.** A request writes D1 and answers; the queues and the cron carry the work to Zoho, WhatsApp and AILabTools; and the cron's sweeper puts back on a queue whatever went quiet. D1 is where every retry starts from.
- **D1 is the record of bookings, visits, technicians and pieces; Razorpay is the record of money.** D1 keeps a mirror of Razorpay's payments, read afresh from Razorpay and never written as the truth (ADR 0044). Zoho Books is written from D1: a customer by the five-minute Books pass, and an invoice from our own figures (ADR 0110).
- **Every vendor is behind an adapter** in `src/providers/`, with a stub. Locally every one is a stub, and nothing leaves the machine. Production refuses to start with a stub.
- **The free plan is a rule, not a hope** (ADR 0009). Daily ceilings keep R2 from billing, a test proves them, and a Worker may hold 64 vars and secrets at most.
- **Business rules live once, in `src/policy/`,** most quoting their brief's own words (`RULES`), which their tests name; the data they read is `src/config/`. What may import what is `docs/architecture.md`, and a test holds src/ to it.
- **zod is the contract.** Each route declares its request and answer in zod; `npm run openapi` writes the OpenAPI documents, the API reference and each front end's types from them.

## Words

The few that come up everywhere. `docs/glossary.md` has the rest, and says which word means what where a thing has several names.

| Word            | Means                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| **surface**     | One of the four sites mm-api answers: public, client, ops and tech (`ENABLED_SURFACES`, ADR 0026)                    |
| **appointment** | A visit booked: the `appointments` table, D1's own record of field work since FSM went (ADR 0110)                    |
| **hold**        | Ten minutes on a technician's time while a client pays; once paid, the visit is booked in the same request           |
| **job event**   | A technician's step (arrived, started, photographs, the outcome), sent from his phone's outbox and landed in D1      |
| **the sweeper** | The cron job that puts back on a queue what went quiet, and deletes what has outlived its use                        |
| **alert**       | A failure that needs a person: kept in the `alerts` table, told once to the alert space, closed when it is put right |
| **PLACEHOLDER** | Copy or material still owed by the owner. Staging shows it; a production build refuses it                            |
| **price book**  | Ops' prices, each from the day it applies, which the site, the apps and Books' items all follow (ADR 0073)           |

## Working locally

Node 24.11 or later (`.nvmrc`, and `engines` in `package.json`).

```sh
npm ci
npm run db:local        # the local database, migrated; the seed needs its tables
npm run db:seed:local   # clients, visits and a technician to sign in as
npm run dev:all         # mm-api, the public site and the three apps; every login code is 246810
```

`docs/getting-started.md` has the rest: the host each app is opened on (each needs its own, such as `http://app.localhost:4322`), the commands that stand in for the cron, Razorpay and a technician's phone, and moving a port. `npm run dev` runs mm-api alone on `:8787`, with the same login code. To ship a change, read `CONTRIBUTING.md`. Locally every provider is a stub, and Turnstile uses Cloudflare's test keys: send `"turnstile_token": "XXXX.DUMMY.TOKEN.XXXX"`.

## Checks

CI runs each of these. `npm run verify` runs them all in one, but for coverage and the browser tests:

```sh
npm run typecheck && npm run check:types   # every project, and the generated Env types against wrangler.jsonc
npm run lint
npm run format:check                       # npm run format fixes it
npm test                                   # the Worker tests in workerd and the rest in Node, about five minutes
npm run test:coverage                      # the same, held to 90% of lines and 80% of branches in src/
npm run check:config                       # environment isolation, and 64 vars and secrets at most
npm run check:migrations                   # forward-only; a contract step names its ADR (docs/migrations.md)
npm run check:open-points                  # one number a point, and every citation of one names a point that exists
npm run check:dead                         # no file or export in src/ that nothing uses (knip.jsonc)
npm run build                              # the site, the apps and every Worker, for every environment, as a dry run
npm run test:e2e                           # the browser tests; build each surface first: npm run build:<site|app|ops|tech> -- --env local
```

After changing a route's schema, run `npm run openapi`: it regenerates `docs/openapi*.json`, `docs/api*.md` and each front end's `api-schema.ts`, and the contract test fails until you do. After changing bindings, vars or the secrets listed in `.dev.vars.example`, run `npm run types`. After adding an ADR or changing its status, run `npm run adr-index`; after a migration adds or changes a table, run `npm run schema`; a test fails until each is run. After changing crons, queue consumers or routes, an operator runs `npm run apply-triggers -- --env <env>` once the code is deployed (ADR 0010).

## Deploys

A merge to `main` deploys all five Workers to staging (`.github/workflows/deploy-staging.yml`), then smokes every host. Production is released by hand with `deploy-production.yml`, for a commit that passed staging: mm-api first, as a canary on part of the traffic, then the rest, rolling everything back if a check fails (ADR 0006). Migrations run before the code and are never rolled back. `docs/runbook.md` has provisioning, incidents, restoring D1 and rolling back by hand.

## Layout

```
src/                  mm-api
  index.ts            the Worker: requests by host, the queue consumers, the cron
  app.ts              one app per surface, and the routes each answers
  config/             data: environments, settings, limits, booking choices, notices, presets, message texts, queue contracts
  policy/             the business rules, most quoting their brief's words, which their tests name; what ops may set
  domain/             what the rules act on: bookings, visits, payments, invoices, alerts; no HTTP here
  http/               what a request carries: its types, sessions, Access and the ops audit, idempotency, and adapters to the domain
  lib/                small helpers: India's time, durations, hashes, signed tokens, the cron's call budget
  providers/          each vendor behind an interface, with its stub
  queues/             the queue consumers: crm-sync, messaging, render
  scheduled/          the cron's jobs: the sweeper, the Razorpay catch-up, the WhatsApp bridge check, referrals, retention
  routes/             one module per route or group of routes, zod schemas included
  guard.ts            the startup guard and the database-identity check
  log.ts              the only logger; it redacts personal data
migrations/           D1, numbered and forward-only
site/                 mm-site: the Astro site and the Worker in front of it (docs/frontend.md)
apps/app/             mm-app: the client app (docs/front-ends.md)
apps/ops/             mm-ops: the ops console
apps/tech/            mm-tech: the technician app, and its service worker
packages/brand/       the tokens, fonts, icons and marks every front end shares
packages/ui/          the React components and hooks the three apps share
packages/web-kit/     the apps' API client and security headers, India's dates, rupees, mobile numbers, WhatsApp's links
test/worker/          mm-api's tests, inside workerd, each on a freshly migrated D1
test/node/            everything else: the scripts, the policies, the front ends' logic, the free-tier budget
e2e/                  the browser tests: the site at its root, then app/, ops/ and tech/
scripts/              build, dev, seed, checks, release, smoke, Zoho set-up, imports
design/               the owner's designs: the site, the Phase 2 boards, the brand kit
data/                 the AILabTools style catalogue, the pincodes, a sample referral log
ops/runner/           the self-hosted CI runner's image, retired: CI runs on GitHub's runners (docs/runbook.md)
docs/                 indexed by docs/README.md
```

## Documents

`docs/README.md` finds every document, by what you are here to do: start, change, operate or look something up. The ways in most people need:

| Document                  | What it is                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `docs/walkthrough.md`     | The whole platform as its users meet it: a booking, a visit, a payment, a referral, an alert |
| `docs/getting-started.md` | The whole system on your laptop                                                              |
| `docs/front-ends.md`      | The four front ends: how each is built, run, tested and deployed, and what they share        |
| `docs/runbook.md`         | Provisioning, incidents, alerts, restoring D1, rolling back                                  |
| `docs/go-live.md`         | What takes each release to production, in the owner's order                                  |
| `docs/open-points.md`     | What is still owed before production, and what staging uses meanwhile                        |
| `docs/decisions/`         | The ADRs, indexed in `docs/decisions/README.md`; 0025 is the register of the owner's rulings |
