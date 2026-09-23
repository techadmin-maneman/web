# 0006. Deployment pipeline

- Status: accepted (required checks and reviewers wait for the GitHub plan; see 0008)
- Date: 2026-09-21

## Decision

**Pull requests** (`.github/workflows/ci.yml`). Six jobs that run side by side, and `checks`, which needs them all (see "The runner" and "Parallel jobs" below for how the shape got here):

- `what changed`: which of the jobs below this pull request can affect;
- `static checks`: `typecheck`, including that the generated `Env` types match `wrangler.jsonc`; `lint`, including actionlint on the workflows; `format`; the real configs pass and the broken fixture fails; migrations are forward-only and unchanged against the base branch; the dependency audit, with registry signatures;
- `tests (unit, contract, coverage)`: unit and contract tests and 85% line coverage of `src/`, in one run;
- `build`: every Worker bundled for all three environments;
- `browser tests and Lighthouse`: the site at 390 and 1440 px, the client app at 390 and the ops console at 1440 against a local `mm-api`, then Lighthouse on `/`, `/try` and `/book`;
- `smoke (local)`: every migration applied to an empty D1 with none left over, both Workers under `wrangler dev`, the smoke suite, and a production-with-stubs Worker that must refuse to start;
- `checks`: passes when each of the six passed or was skipped. It is the one job the deploy workflows and main's protection depend on.

**Merge to main** (`deploy-staging.yml`): the same checks, then staging D1 migrations and identity mark, then a new version of each Worker at 100%. The smoke suite then runs against `staging.maneman.in` through an Access service token, and requires `/api/health` to report the merged commit as its version tag.

**Production** (`deploy-production.yml`), started by hand with a commit SHA:

1. The commit must be on `main` and have a successful staging run.
2. The job runs in the `production` GitHub Environment (required reviewers).
3. It records the versions serving now, applies migrations and marks the database.
4. It uploads the new `mm-api` version with no traffic, then splits traffic (default 10% new, 90% old).
5. It smokes the new version with `Cloudflare-Workers-Version-Overrides`, soaks (default 5 minutes), smokes again, promotes to 100%, and smokes again.
6. It deploys `mm-site`, then runs a final smoke.

Any failure after the first traffic change returns both Workers to the versions recorded at the start.

**Migrations** run before code and are never rolled back. `scripts/check-migrations.ts` enforces numbering, immutability of migrations already on the base branch, and that a `DROP`, `RENAME` or `DELETE` ships only as a contract step naming its ADR.

**Versions, not `wrangler deploy`**, in both environments: staging rehearses exactly what production does, and CI never needs permission to change routes.

## The runner (22 September 2026)

GitHub gives a private repository 2,000 minutes of its runners a month. Ten jobs per pull request, each billed a minute at least, and the same ten again before every staging deploy, used them in two days (21 and 22 September 2026), and GitHub stopped starting jobs. The owner chose to keep the pipeline free without loosening it:

- **The jobs run on the owner's machine,** in a container: Ubuntu, as GitHub's runners are, with GitHub's runner agent and actionlint pinned and checked (`ops/runner/`). Jobs run as an unprivileged user; nothing of the machine is mounted, so a job sees only what it checks out. Its minutes are free. It needs the machine on, and Docker running.
- **Every workflow chooses its runner by the repository variable `CI_RUNNER`:** "maneman" for the machine, anything else for GitHub's runners, so turning the variable off moves everything back within the free minutes' limits.
- **The pull request checks are one job,** so a run costs one job's time on either. (Until 23 September 2026; see "Parallel jobs" below.)
- **npm's cache is the runner's own,** on its disk between jobs. GitHub's cache, fetched over the network, took three to six minutes a run on the machine, and once stalled a run outright; GitHub's own runners keep using it.
- **A lost reply is not a failed upload.** Cloudflare's API sometimes accepts a version upload and never answers: the request hangs about five minutes and the connection drops ("terminated"), and wrangler exits 1 although the version is on the account. Six staging deploys failed that way on 22 September 2026, from the runner and from a laptop alike. `scripts/release.ts` now asks for the version by its tag before failing, and the same for a traffic split that may already be live. Work that is the same done twice — applying the migrations that are missing, marking the database — is simply run again (`scripts/lib/cloudflare-api.ts`).
- **Nothing about what runs changed:** every check still runs on every pull request and again before every staging deploy, and production still needs its manual start, a commit on `main`, and a successful staging deploy of that commit (`deploy-production.yml`, "commit is on main and passed staging").

## Parallel jobs (23 September 2026)

One job ran every check in turn, about thirteen minutes, of which the browser tests were four. A second runner (docs/runbook.md, "The CI runner") means independent checks can run at the same time, so `ci.yml` is six jobs again, grouped so each is worth an install of its own, and a `checks` job that needs them all.

- **What a job costs is what groups it.** The browser tests are the longest, so they are a job of their own and start at once; the static checks, the test suite, the build dry run and the local smoke fill the other runner. Lighthouse stays with the browser tests, after them: it measures a page load, and it should not be sharing the machine with a suite this run started.
- **`checks` is the gate.** `deploy-staging.yml` waits for this workflow, and a workflow fails when a job in it fails; `checks` needs every job and fails unless each one passed or was skipped. So one name still stands for the whole of CI, for the deploy workflows and for main's protection once the plan allows required checks (0008).
- **A change that no build and no browser can see skips them.** `what changed` compares the pull request with its base: when every file is under `docs/` or `design/` or is a note at the repository root, the build, the browser tests, Lighthouse and the local smoke are skipped, and `checks` counts a skipped job as a pass, so a documentation pull request is still mergeable. Anything else runs them all, `src/` and the configs included: the browser tests drive a local `mm-api`, so they are not the front end's alone. The tests and the static checks run whatever changed. A staging deploy filters nothing.
- **Coverage is still one run** of the whole suite, so the 85% threshold still measures all of `src/`.
- **Each job installs for itself.** `npm ci` from the runner's own npm cache takes about 40 seconds, and the jobs it repeats for run beside each other, so it costs less than the waiting it removes. Caching `node_modules` between jobs would mean GitHub's cache over the network, which took three to six minutes a run on this machine ("The runner", above).
- **On GitHub's runners a run bills seven jobs,** each a minute at least, where it used to bill one. The escape hatch in the runbook is that much dearer; on the machine the minutes are free.
- **Nothing about what runs changed:** every check the one job ran still runs, in the same order within its job, on every pull request that can affect it and on every staging deploy.

## Open items

- `wrangler versions upload` and `versions deploy` do not apply triggers: routes, cron schedules or queue consumers. Routes are set at bootstrap (0004). M2 adds the sweeper cron and the `crm-sync` consumer, and must decide how CI applies trigger changes and what token permission that takes.
- A Worker's first deployment is an owner-run bootstrap (`docs/runbook.md`). A gradual rollout needs a previous version to split with and to roll back to.
