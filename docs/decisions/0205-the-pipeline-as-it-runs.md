# 0205. The pipeline as it runs

- Status: accepted
- Date: 2026-10-15
- Topic: Platform
- Supersedes [0006](0006-deployment-pipeline.md), whose amendments over three weeks it brings into one page; 0006 keeps the history of how each part got here

## Context

ADR 0006 set the pipeline on 21 September 2026 and was amended in place eight times as the runner, the tiers and the merge rule changed, so today's pipeline could only be read by following a diary. This record says what runs now, and nothing of what was tried before.

## Decision

### On every push to a pull request

`.github/workflows/ci.yml` runs on GitHub's hosted runners (the repository is public, so they cost nothing; `docs/runbook/ci-runner.md`). A label starts no run. Its jobs:

- **what changed**: which jobs this pull request's files can affect, and which checks an earlier run already passed on exactly these files (`scripts/lib/already-checked.ts`): a check passed on the same files is taken as passed, and only work done counts, never a skip.
- **static checks**: the type-check, with the generated `Env` types against `wrangler.jsonc`; lint, in four parts so no part outgrows the heap (`scripts/ci/lint.ts`), with actionlint on the workflows; formatting; the configs; migrations forward-only and unchanged against the base branch (`npm run check:migrations`); and, when what is installed changes, registry signatures.
- **unit tests**, in two halves on two runners, each keeping its coverage; then **tests**, which merges them and holds them to the floors in `vitest.config.ts`: mm-api's code and the scripts' shared modules, with floors of their own for the vendor clients and the money modules, and the front ends', each glob to its own.
- **deployed code on these migrations**, when a migration changed: the base branch's Worker tests on this branch's migrations (`scripts/ci/old-code-on-new-schema.ts`), since that code runs on them until the deploy and after a rollback.
- **build**: every Worker bundled for every environment without deploying, and production's built pages opened in Chromium (`scripts/ci/production-pages.ts`).
- **browser tests**, in two halves, every project, with Lighthouse in the first against each page's budget; Playwright tries a failed test once more, and the nightly run (`nightly-browser.yml`) fails on any test that needed it.
- **smoke (local)**: every migration on an empty D1, the Workers under `wrangler dev`, the smoke suite, and a production-with-stubs Worker that must refuse to start.
- **full suite**: passes once every job above passed or was rightly skipped. It is the one job a merge and a deploy look for.

CI warns past 800 changed lines in files people wrote (`scripts/lib/pr-size.ts`); a pull request is one batch of related work (CONTRIBUTING.md, "Keep it small").

### Merging

A ready pull request whose branch is in this repository merges once the full suite passed on its current head (`.github/workflows/auto-merge.yml`, `scripts/lib/auto-merge.ts`). One that touches money or personal data (`SENSITIVE_PATHS`), or updates a dependency, waits for the `reviewed` label, which any later push takes off (`.github/workflows/review-label.yml`); whoever lands it gives it, once they have read it through (CONTRIBUTING.md, "When a person must look"). `hold-for-review` holds any pull request. It lands as a merge commit, so each commit in it stays revertable.

### Staging, on every merge

`deploy-staging.yml` calls `ci.yml` on what merged, which runs only what the merged head did not pass on the same files, and deploys only on a pass: the database's identity checked, mm-api's version uploaded with no traffic, the staging D1 migrated and marked, then every Worker's new version at 100%. The smoke suite then runs against staging through an Access service token, requiring `/api/health` to name the merged commit, and against each app's host, requiring its own app built from that commit; then every host's pages under their content security policy (`npm run smoke:csp`); then, read-only, the live triggers and buckets against the configs, and mm-api's CPU time over the last day. The words the Words page publishes reach staging's site by `site-words.yml`, which builds the commit staging runs and ships only while it still runs it.

Staging is watched hourly (`watch-staging.yml`) and its money path walked nightly (`watch-money-path.yml`).

### Production, by hand

`deploy-production.yml`, started with a commit SHA, once a week while the surfaces are off:

1. The commit must be on main with a successful staging run.
2. It records the version each Worker serves, checks the database's identity, uploads mm-api's new version with no traffic, then migrates and marks the database.
3. It gives the new version a share of traffic (10% by default), smokes it with `Cloudflare-Workers-Version-Overrides`, soaks it (5 minutes by default) against the old version's error rate where Workers analytics can be read, smokes it again, promotes it to 100% and smokes it once more.
4. It ships mm-site, then each app whose surface is on in production, smokes the site and every switched-on host, and opens every host's pages under their policy.

Any failure after the first change of traffic returns every Worker to the version it recorded first.

### Throughout

- **Migrations run before code and are never rolled back.** A `DROP`, `RENAME` or `DELETE` ships only as a contract step naming its ADR (`docs/migrations.md`).
- **Versions, not `wrangler deploy`**, in both environments, so staging rehearses exactly what production does, and CI never needs permission to change routes. Routes, cron schedules and queue consumers are set at bootstrap, by an operator (0004, 0010).
- **A failure tells someone.** A failed deploy pages whoever is on call (`.github/actions/page`); a failing watch or nightly run opens an issue, or adds to the open one (`.github/actions/failing-issue`).
- **The shell decides nothing.** What a deploy decides, whether a Worker is shipped and what a rollback restores, is in `scripts/release/release.ts`, with tests; `test/node/tooling/deploy-workflows.test.ts` pins what the workflows keep to.

## Consequences

- One page to read for the pipeline; 0006 stays for how each part got here.
- A change to the pipeline amends this record, in a short dated line under its status, or replaces it with another, rather than growing a diary here.
