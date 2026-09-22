# 0006. Deployment pipeline

- Status: accepted (required checks and reviewers wait for the GitHub plan; see 0008)
- Date: 2026-09-21

## Decision

**Pull requests** (`.github/workflows/ci.yml`). One job, `checks`, runs each of these in turn, cheapest first (until 22 September 2026, each was its own job; see "The runner" below):

- `typecheck`, including that the generated `Env` types match `wrangler.jsonc`;
- `lint`, including actionlint on the workflows;
- `format`;
- `test`: unit, contract and 85% line coverage;
- `config check`: the real configs pass; the broken fixture fails; migrations are forward-only and unchanged against the base branch;
- `migrations apply`: every migration applies to an empty D1, with none left over;
- `dependency audit`, with registry signatures;
- `build`: both Workers bundled for all three environments;
- `smoke (local)`: both Workers under `wrangler dev`, the smoke suite, and a production-with-stubs Worker that must refuse to start.

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
- **The pull request checks are one job,** so a run costs one job's time on either.
- **Nothing about what runs changed:** every check still runs on every pull request and again before every staging deploy, and production still needs its manual start, a commit on `main`, and a successful staging deploy of that commit (`deploy-production.yml`, "commit is on main and passed staging").

## Open items

- `wrangler versions upload` and `versions deploy` do not apply triggers: routes, cron schedules or queue consumers. Routes are set at bootstrap (0004). M2 adds the sweeper cron and the `crm-sync` consumer, and must decide how CI applies trigger changes and what token permission that takes.
- A Worker's first deployment is an owner-run bootstrap (`docs/runbook.md`). A gradual rollout needs a previous version to split with and to roll back to.
