# 0003. Environment identity guard

- Status: accepted
- Date: 2026-09-21

## Context

The prompt: "The Worker reads `ENVIRONMENT` and refuses to start if it is missing, if it disagrees with the D1 database name, or if a production Worker holds a stub provider."

Two platform facts shape how:

1. A Worker cannot read the name of the database behind its D1 binding at runtime.
2. A Worker has no startup hook, but it does evaluate its module's global scope when it is uploaded and when an isolate starts, and `env` is readable there (`import { env } from "cloudflare:workers"`). An exception at global scope fails the upload and stops `wrangler dev` from starting.

The prompt also names no variable for choosing between a real provider and its stub.

## Decision

**Static checks, at module load** (`validateStaticConfig`, called at global scope in `src/index.ts`). Refuse, listing every problem, when:

- `ENVIRONMENT` is missing, empty, or not `local`, `staging` or `production`;
- `IMAGE_PROVIDER`, `CRM_PROVIDER` or `MESSAGING_PROVIDER` is missing or unknown;
- `ENVIRONMENT` is `production` and any provider is `stub`.

These three provider variables are added to the prompt's var list so the stub rule is checkable. Staging may hold a stub, because the WhatsApp BSP is only chosen at the 4 October gate.

**Database identity, on first use.** Migration 0001 creates `deployment_identity`, a single-row table that triggers make immutable. `scripts/mark-database.ts <env>` writes `maneman-local`, `maneman-staging` or `maneman-prod` into it once, after migrations, in each environment's pipeline, then reads it back. Before serving any `/api/*` route the Worker compares the row with the name expected for its `ENVIRONMENT`:

- match: served, and the result is cached for the life of the isolate;
- no row, or another environment's name: `503 environment_mismatch`;
- query fails: `503 unavailable`.

Failures are not cached, so marking the database takes effect without a redeploy. `/api/health` is exempt from the gate and reports the state instead (`d1: ok | unmarked | mismatch | unreachable`), which is what the smoke suite checks after every deploy.

**Static cross-check.** `npm run check:config` also fails if an environment's `vars.ENVIRONMENT` disagrees with its block, or its D1 `database_name` is not that environment's.

## Consequences

- A production Worker with a stub provider cannot be deployed: the upload itself fails. Verified with `wrangler dev`; the remote rejection is confirmed on the first real deploy (see `docs/verification.md`).
- A config that binds staging to the production database is caught three times: by the config check, by `mark-database.ts` reading back the wrong name, and by the Worker refusing to serve.
- An environment's database must be marked before its Worker serves. The pipelines do it; the runbook covers a manual restore.
