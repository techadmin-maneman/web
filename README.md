# Mane Man web

Phase 1 (the public site, booking and the try-on) is complete on staging, and its production release waits for the owner. Phase 2 (the client app, referrals, the ops console and the technician app, over Zoho FSM) is in progress. The briefs are in `docs/prompts/`; the decisions in `docs/decisions/`, with the Phase 2 conflicts in 0025.

Two Cloudflare Workers on one origin:

- **`mm-api`** (repository root): `https://{host}/api/*`. Owns every binding and secret: D1, R2 and Queues.
- **`mm-site`** (`site/`): everything else. The Astro site, static assets only (`docs/frontend.md`). Production still serves a placeholder page until the owner releases the site; every build keeps the `mm-worker` and `mm-environment` meta tags the smoke suite looks for.

|           | local                        | staging                                            | production                   |
| --------- | ---------------------------- | -------------------------------------------------- | ---------------------------- |
| Host      | `localhost` (`wrangler dev`) | `staging.maneman.in`, Cloudflare Access, `noindex` | `maneman.in`                 |
| D1        | local SQLite                 | `maneman-staging`                                  | `maneman-prod`               |
| Providers | stubs                        | real                                               | real (stubs refuse to start) |

Both environments are deployed in the Cloudflare account that holds `maneman.in`. The steps still owed are in `docs/runbook.md`, "Provisioning an environment".

Endpoints so far: `GET /api/health`, `GET /api/cities` and `POST /api/lead` (the booking form and waitlist). Leads are saved in D1 first and reach Zoho through the `crm-sync` queue. See `docs/api.md`.

The account stays on Cloudflare's free tier; the rules are in `docs/decisions/0009-stay-inside-cloudflare-free-tier.md`.

Deploys: a merge to `main` deploys staging (`.github/workflows/deploy-staging.yml`). Production is released by hand with `deploy-production.yml`, for a commit that passed staging.

## Working locally

Node 24.11 or later (`.nvmrc`, and `engines` in package.json).

```sh
npm ci
npm run dev          # creates .dev.vars, migrates and marks the local D1, then mm-api on :8787
npm run dev:site     # mm-site placeholder on :8788
npm run smoke -- --api-base http://localhost:8787 --site-base http://localhost:8788 --environment local
```

Locally every provider is a stub and Turnstile uses Cloudflare's test keys: send `"turnstile_token": "XXXX.DUMMY.TOKEN.XXXX"`. The local queue delivers leads to the stub CRM within a few seconds.

## Checks (each is a CI job)

```sh
npm run verify              # all of these in one, the tests without coverage; browser tests: npm run test:e2e
npm run typecheck && npm run check:types
npm run lint
npm run format:check
npm run test:coverage       # Worker tests in workerd, script tests in Node; 85% lines on src/
npm run check:config        # environment isolation in both wrangler configs
npm run check:migrations    # forward-only, contract steps need an ADR (docs/migrations.md)
npm run build               # both Workers, every environment, dry run
```

After changing a route schema, run `npm run openapi` to regenerate `docs/openapi.json` and `docs/api.md`; the contract test fails until you do. After changing bindings, vars or the secrets listed in `.dev.vars.example`, run `npm run types`. After changing crons, queue consumers or routes, an operator runs `npm run apply-triggers -- --env <env>` once the code is deployed (ADR 0010).

## Layout

```
src/                  mm-api
  config/             environments, settings, booking choices, notices, try-on presets and limits
  domain/             leads, cities, visit dates, rate limits, ceilings, try-on jobs
  providers/          CRM (Zoho), images (AILabTools), WhatsApp (Evolution), each with a stub; Turnstile, alerts
  queues/             queue consumers: crm-sync, render, messaging
  scheduled/          the sweeper
  guard.ts            startup and database-identity guard
  log.ts              the only logger; redacts personal data
  routes/             one module per route, zod schemas included
migrations/           D1, numbered, forward-only
data/                 the AILabTools style catalog (verbatim)
site/                 mm-site placeholder
scripts/              build, checks, release, smoke, the free-tier budget
test/worker/          tests inside workerd
test/node/            tests of the scripts, and the free-tier budget
docs/decisions/       ADRs
docs/reference/       AILabTools API notes (verbatim), and where the browser-side code lives
```

## Documents

- `docs/api.md`, `docs/openapi.json`: generated API reference
- `docs/decisions/`: architecture decisions
- `docs/migrations.md`: how to write a migration D1 will take, and delete rows other rows point at
- `docs/runbook.md`: provisioning, Zoho setup, incidents, cities and blackouts, rollback
- `docs/turnstile.md`: the Turnstile site keys for the front-end
- `docs/verification.md`: each milestone's definition of done, with evidence
