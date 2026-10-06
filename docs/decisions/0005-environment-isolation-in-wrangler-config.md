# 0005. Environment isolation in the wrangler config

- Status: accepted
- Date: 2026-09-21
- Topic: Platform

## Context

The prompt: "A binding that is not redeclared inside an environment block must fail the config check in CI; inheriting a top-level binding is how staging writes to production."

The requirement stands; the stated mechanism is not how wrangler behaves. Wrangler does **not** inherit bindings (`vars`, `d1_databases`, `r2_buckets`, `queues` and the rest are non-inheritable). A binding missing from an environment leaves that environment without it, and the Worker fails at runtime. Wrangler **does** inherit `routes`, `workers_dev`, `preview_urls`, `account_id`, `triggers` and `name`. A top-level route inherited by staging is the real way one environment reaches another's traffic.

## Decision

The top level of each `wrangler.jsonc` is the local environment only. `npm run check:config` (`scripts/lib/wrangler-config-check.ts`) fails when:

- staging or production is missing;
- a non-inheritable key at the top level is not redeclared in an environment, or declares different binding names, or an environment declares one the top level lacks;
- `name`, `account_id`, `workers_dev`, `preview_urls`, `observability` or `routes` is not set explicitly in a remote environment, or has an unsafe value (`workers_dev` or `preview_urls` true, observability off, wrong Worker name);
- `routes` sits at the top level, or an environment's route is not exactly `{host}/api/*` (mm-api) or `{host}/*` (mm-site) on the `maneman.in` zone;
- `triggers` exists at the top level and an environment inherits it;
- a resource name (D1 database, bucket, queue, consumer, dead-letter queue) lacks its environment's token (`local`, `staging`, `prod`) or carries another's, or two environments share a resource or a real D1 ID;
- `vars.ENVIRONMENT` disagrees with the block, or the D1 database is not the environment's;
- mm-site declares any binding or any code; the two Workers of an environment deploy to different accounts;
- at deploy time (`--require-provisioned`), a D1 ID is still the placeholder.

## Consequences

- The check is proved in both directions: tests break the real config one rule at a time (`test/node/tooling/wrangler-config-check.test.ts`), and CI requires the committed broken fixture to be rejected.
- Adding a binding means adding it at the top level and in both environments, named for each; the check says which one is missing.
