# Mane Man web: Phase 1 backend

Two Cloudflare Workers on one origin:

- **`mm-api`** (repository root): `https://{host}/api/*`. Owns every binding and secret: D1, R2, Queues.
- **`mm-site`** (`site/`): everything else. Static assets only. Today a placeholder page per environment; the front-end task replaces it with the Astro build and must keep the `mm-worker` and `mm-environment` meta tags the smoke suite looks for.

|           | local                        | staging                                            | production                   |
| --------- | ---------------------------- | -------------------------------------------------- | ---------------------------- |
| Host      | `localhost` (`wrangler dev`) | `staging.maneman.in`, Cloudflare Access, `noindex` | `maneman.in`                 |
| D1        | local SQLite                 | `maneman-staging`                                  | `maneman-prod`               |
| Providers | stubs                        | real                                               | real (stubs refuse to start) |

Staging and production are **not provisioned yet**. See `docs/decisions/0007-platform-constraints.md`.

## Working locally

Node 24 (`.nvmrc`).

```sh
npm ci
npm run dev          # migrate and mark the local D1, then mm-api on :8787
npm run dev:site     # mm-site placeholder on :8788
npm run smoke -- --api-base http://localhost:8787 --site-base http://localhost:8788 --environment local
```

## Checks (each is a CI job)

```sh
npm run typecheck && npm run types:check
npm run lint
npm run format:check
npm run test:coverage       # Worker tests in workerd, script tests in Node; 85% lines on src/
npm run check:config        # environment isolation in both wrangler configs
npm run check:migrations    # forward-only, contract steps need an ADR
npm run build               # both Workers, every environment, dry run
```

After changing a route schema, run `npm run openapi` to regenerate `docs/openapi.json` and `docs/api.md`; the contract test fails until you do. After changing bindings or vars, run `npm run types`.

## Layout

```
src/                  mm-api
  config/             environments and the resources each must use
  guard.ts            startup and database-identity guard
  log.ts              the only logger; redacts personal data
  routes/             one module per route, zod schemas included
migrations/           D1, numbered, forward-only
site/                 mm-site placeholder
scripts/              build, checks, release, smoke
test/worker/          tests inside workerd
test/node/            tests of the scripts
docs/decisions/       ADRs
```

## Documents

- `docs/api.md`, `docs/openapi.json`: generated API reference
- `docs/decisions/`: architecture decisions
- `docs/runbook.md`: provisioning, rollback, and incident procedures
- `docs/verification.md`: each milestone's definition of done, with evidence
