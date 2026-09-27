# 0006. Deployment pipeline

- Status: accepted (required checks and reviewers wait for the GitHub plan; see 0008). Amended 25 September 2026: "Deploys that prove what they shipped"; 27 September 2026: the coverage gate ([0075](0075-tests-held-to-the-contract-and-the-local-stack.md)).
- Date: 2026-09-21

## Decision

**Pull requests** (`.github/workflows/ci.yml`). Seven jobs that run side by side, and `checks`, which needs them all (see "The runner" and "Parallel jobs" below for how the shape got here):

- `what changed`: which of the jobs below this pull request can affect;
- `static checks`: `typecheck`, including that the generated `Env` types match `wrangler.jsonc` (`check:types`); `lint`, including actionlint, pinned by digest, on the workflows; `format`; the real configs pass and the broken fixture fails; migrations are forward-only and unchanged against the base branch; the dependency audit, with registry signatures;
- `tests (unit, contract, coverage)`: unit and contract tests, and coverage of `src/` (90% of lines and 80% of branches, with floors for the vendor clients: ADR 0075), in one run;
- `deployed code on these migrations`: when a migration changed, the base branch's Worker tests run on this branch's migrations (`scripts/old-code-on-new-schema.ts`);
- `build`: every Worker bundled for all three environments;
- `browser tests and Lighthouse`: the site at 390 and 1440 px, the client app at 390 and the ops console at 1440 against a local `mm-api`, then Lighthouse on `/`, `/try`, `/book`, an invite's landing and the client app's first screen, each against its own budget;
- `smoke (local)`: every migration applied to an empty D1 with none left over, both Workers under `wrangler dev`, the smoke suite, and a production-with-stubs Worker that must refuse to start;
- `checks`: passes when each of the seven passed or was skipped. It is the one job the deploy workflows and main's protection depend on.

**Merge to main** (`deploy-staging.yml`): the same checks, unless the merged tree is exactly a pull request head that passed them. Then the database identity is checked, `mm-api`'s version is uploaded with no traffic, the staging D1 is migrated and marked, and each Worker's new version goes to 100%. The smoke suite then runs against `staging.maneman.in` through an Access service token, requiring `/api/health` to report the merged commit as its version tag, and against each Phase 2 host, requiring mm-api there and the host's own app at `/`, built from the merged commit. Last, read-only, the live triggers and buckets are compared with the configs.

**Production** (`deploy-production.yml`), started by hand with a commit SHA:

1. The commit must be on `main` and have a successful staging run.
2. The job runs in the `production` GitHub Environment. Required reviewers wait for the paid GitHub plan (0008), so nobody has to approve it today.
3. It records the version each Worker serves now, checks the database identity, uploads the new `mm-api` version with no traffic, then applies migrations and marks the database.
4. It splits traffic (default 10% new, 90% old).
5. It smokes the new version with `Cloudflare-Workers-Version-Overrides`, soaks (default 5 minutes) watching the new version's real error rate where the token can read Workers analytics, smokes again, promotes to 100%, and smokes again.
6. It deploys `mm-site`, then each app that is deployed in production, then smokes the site and every switched-on Phase 2 host.

Any failure after the first traffic change returns every Worker to the version recorded at the start.

**Migrations** run before code and are never rolled back. `scripts/check-migrations.ts` enforces numbering, immutability of migrations already on the base branch, and that a `DROP`, `RENAME` or `DELETE` ships only as a contract step naming its ADR. The deployed code's own Worker tests run on a pull request's new migrations, since that code runs on them until the deploy.

**Versions, not `wrangler deploy`**, in both environments: staging rehearses exactly what production does, and CI never needs permission to change routes.

## The runner (22 September 2026)

GitHub gives a private repository 2,000 minutes of its runners a month. Ten jobs per pull request, each billed a minute at least, and the same ten again before every staging deploy, used them in two days (21 and 22 September 2026), and GitHub stopped starting jobs. The owner chose to keep the pipeline free without loosening it:

- **The jobs run on the owner's machine,** in a container: Ubuntu, as GitHub's runners are, with GitHub's runner agent and actionlint pinned and checked (`ops/runner/`). Jobs run as an unprivileged user; nothing of the machine is mounted, so a job sees only what it checks out. Its minutes are free. It needs the machine on, and Docker running.
- **Every workflow chooses its runner by the repository variable `CI_RUNNER`:** "maneman" for the machine, anything else for GitHub's runners, so turning the variable off moves everything back within the free minutes' limits.
- **The pull request checks are one job,** so a run costs one job's time on either. (Until 23 September 2026; see "Parallel jobs" below.)
- **npm's cache is the runner's own,** on its disk between jobs. GitHub's cache, fetched over the network, took three to six minutes a run on the machine, and once stalled a run outright; GitHub's own runners keep using it.
- **A lost reply is not a failed upload.** Cloudflare's API sometimes accepts a version upload and never answers: the request hangs about five minutes and the connection drops ("terminated"), and wrangler exits 1 although the version is on the account. Six staging deploys failed that way on 22 September 2026, from the runner and from a laptop alike. `scripts/release.ts` now asks for the version by its tag before failing, and the same for a traffic split that may already be live. Work that is the same done twice — applying the migrations that are missing, marking the database — is simply run again (`scripts/lib/cloudflare-api.ts`).
- **Nothing about what runs changed:** every check still runs on every pull request and again before every staging deploy, and production still needs its manual start, a commit on `main`, and a successful staging deploy of that commit (`deploy-production.yml`, "commit is on main and passed staging").

**Where the jobs run today (27 September 2026).** `CI_RUNNER` has been `github` since 23 September 2026, 09:21 in India, so every job runs on GitHub's runners and is billed, at seven jobs a pull request and again on each staging deploy that is not skipped ("Deploys that prove what they shipped", below). The machine above is still set up and takes the jobs back when the variable is `maneman`. Whether to go back to it, pay for GitHub's minutes, or thin the runs is the owner's decision.

## Parallel jobs (23 September 2026)

One job ran every check in turn, about thirteen minutes, of which the browser tests were four. A second runner (docs/runbook.md, "The CI runner") means independent checks can run at the same time, so `ci.yml` is six jobs again, grouped so each is worth an install of its own, and a `checks` job that needs them all.

- **What a job costs is what groups it.** The browser tests are the longest, so they are a job of their own and start at once; the static checks, the test suite, the build dry run and the local smoke fill the other runner. Lighthouse stays with the browser tests, after them: it measures a page load, and it should not be sharing the machine with a suite this run started.
- **`checks` is the gate.** `deploy-staging.yml` waits for this workflow, and a workflow fails when a job in it fails; `checks` needs every job and fails unless each one passed or was skipped. So one name still stands for the whole of CI, for the deploy workflows and for main's protection once the plan allows required checks (0008).
- **A change that no build and no browser can see skips them.** `what changed` compares the pull request with its base: when every file is under `docs/` or `design/` or is a note at the repository root, the build, the browser tests, Lighthouse and the local smoke are skipped, and `checks` counts a skipped job as a pass, so a documentation pull request is still mergeable. Anything else runs them all, `src/` and the configs included: the browser tests drive a local `mm-api`, so they are not the front end's alone. The tests and the static checks run whatever changed. A staging deploy filters nothing.
- **Coverage is still one run** of the whole suite, so the thresholds still measure all of `src/`.
- **Each job installs for itself.** `npm ci` from the runner's own npm cache takes about 40 seconds, and the jobs it repeats for run beside each other, so it costs less than the waiting it removes. Caching `node_modules` between jobs would mean GitHub's cache over the network, which took three to six minutes a run on this machine ("The runner", above).
- **On GitHub's runners a run bills seven jobs,** each a minute at least, where it used to bill one. The escape hatch in the runbook is that much dearer; on the machine the minutes are free.
- **Nothing about what runs changed:** every check the one job ran still runs, in the same order within its job, on every pull request that can affect it and on every staging deploy.

## Deploys that prove what they shipped (25 September 2026)

An audit on 24 September 2026 found a green deploy could leave three of the five Workers undeployed or stale, and nothing would say so. What changed:

- **Only "does not exist" reads as not deployed.** The workflows ran `release.ts current … || true`, so an authentication failure, a lost reply or a mid-rollout read as "not bootstrapped" and the Worker was skipped, with the job green. `release.ts current` now answers "" only for an app whose surface is not switched on in that environment and that Cloudflare says does not exist (`scripts/lib/release.ts`, `mustExist`); anything else fails the step, and a dropped reply is asked again. mm-api and mm-site, and any app whose host is live, must exist.
- **The shell decides nothing.** What the workflows did in bash (whether to deploy, what to roll back) is in `scripts/release.ts`, with tests, because a workflow on main cannot be run by a pull request. `ship` uploads and sends all traffic, or passes over an app not deployed yet; `restore` puts every Worker back on its recorded version whatever its own deploy step did, and changes nothing where that version still serves. `test/node/deploy-workflows.test.ts` pins what the workflows must keep to.
- **Every app says what it is.** Each app's build writes its Worker, environment and commit into its page (`mm-version`), and the smoke suite requires each Phase 2 host to serve its own app, built from the commit just deployed. A blank, broken or stale app now fails the deploy, and in production rolls the release back.
- **Nothing touches the database until the release can finish.** The identity check runs before migrations as well as after, and `mm-api`'s version is uploaded before them: an upload sends no traffic and fails on a missing bucket, queue or database, so a missing resource stops the release with the database untouched.
- **The soak watches real traffic.** Where the token can read Workers analytics (Account Analytics: Read, optional), the soak compares the new version's invocation error rate with the old one's and fails the release on a new version that errors far more (`scripts/lib/soak.ts`). Without the permission it says so, and the smoke checks stand alone as before.
- **Old code runs on new migrations.** The migrations check reads SQL; `scripts/old-code-on-new-schema.ts` runs the base branch's Worker tests on the branch's migrations, which catches, for example, a unique index the deployed code's inserts break. The live-database migration test now seeds Phase 2 rows too.
- **What is live is compared with the configs.** After each deploy, read-only, the live cron schedules and queue consumers are compared with every Worker's config (0010), and the buckets with their retention: the try-on buckets must expire every object within 30 days, and no other bucket may expire anything (`scripts/check-buckets.ts`). CI's tokens may not read queues or R2, by design, so those checks say so in CI and an operator runs them with their own token.
- **A merge already checked is not checked again.** When the pushed tree is exactly the head of the pull request it merged, and that head passed `ci.yml`, the staging deploy skips the re-run (`scripts/already-checked.ts`): about nine of the deploy's eleven minutes. Anything else, or anything GitHub cannot answer, runs every check. On GitHub's runners Playwright's browsers are cached by version.
- **A production build refuses unfinished copy.** A production build of an app refuses copy still marked PLACEHOLDER, and the site's production build does the same for the referral landing (`scripts/lib/content-gate.ts`). `npm run build`, which only proves production bundles, lets it through.

## Open items

- `wrangler versions upload` and `versions deploy` do not apply triggers: routes, cron schedules or queue consumers. Routes are set at bootstrap (0004). Settled in 0010: an operator applies them.
- A Worker's first deployment is an owner-run bootstrap (`docs/runbook.md`). A gradual rollout needs a previous version to split with and to roll back to.
