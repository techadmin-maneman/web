# Shipping a change

One page on getting a change from your laptop to staging. `README.md` says what the platform is, `docs/README.md` finds every other document, and `docs/getting-started.md` runs it all locally.

## Start to finish

1. **Branch from `main`:** `git switch -c booking-ten-minute-hold`.
2. **Open a draft pull request early:** `gh pr create --draft`. Title it `<area>: <what changes>`, in 72 characters or fewer, as `booking: hold a window for ten minutes while the client pays`. The area is a folder or a product word: `booking`, `site`, `ops`, `tech`, `docs`, `ci`.
3. **Make the change, with its tests.** A rule goes in `src/policy/`, its effect in `src/domain/`, its route in `src/routes/` (README, "Layout"). Every bug fixed gets the test that would have caught it.
4. **Keep the comments true.** When you change code, read the comment beside it and fix it or delete it (below, "Comments").
5. **Check before you push:**
   - `npm run typecheck && npm run lint && npm run format:check`;
   - the tests beside what you changed: `npx vitest run test/worker/booking/bookings.test.ts`;
   - for a screen you changed, its browser tests, after building it: `npm run build:app -- --env local && npx playwright test e2e/app/booking.e2e.ts`;
   - after changing a route's schema, a migration, a binding, an ADR's status, the copy or a setting, `npm run gen`. CI fails until the generated files match.
6. **Mark it ready.** CI runs every check on each push. A ready pull request from this repository merges itself once CI passes, and its merge deploys to staging.
7. **Clear up after the merge.** GitHub deletes the pull request's branch. Delete your copy before pruning, while git can still see it was pushed: `git switch main && git pull --ff-only && git branch -d booking-ten-minute-hold && git fetch --prune`. A worktree made for it goes first: `git worktree remove <its folder>`.

## Where a test goes

- By where it runs first, then by the part of the product it checks: `test/worker/<area>/` runs against the API in workerd (`booking`, `money`, `field`, `dispatch`, `inventory`, `purchasing`, `care`, `reports`, `words`, `ops` for the console's own work, `site`, `app`, `referrals`, `messages`, `vendors`, `privacy`, `jobs`, `platform`), mirroring `src/domain/`'s folders where a test is of one, and `test/node/<area>/` in plain Node (`policy`, `api`, `database`, `apps/<app>`, `site`, `packages`, `architecture`, `tooling`, `words`).
- A test of an app's code that runs in plain Node but needs the DOM's types goes in `test/node/front-ends/`; one of a component on a page, in a DOM, in `test/dom/`; a browser test, in `e2e/<surface>/`.
- A file past 500 lines is warned of: split it by what each part checks, with its shared setup in a `-fixtures.ts` beside it.
- A worker test writes its people, addresses, visits, technicians, holds and payments through `test/worker/fixtures/` (`aPerson`, `aVisit`, `aTechnician`…), each with its defaults and your overrides, never as an INSERT of its own; `test/node/tooling/test-data.test.ts` counts those still written by hand, and the count only falls.
- A query's row type comes from `src/lib/rows.ts`, written from the migrations by `npm run schema`: `Pick<Rows["people"], "id" | "name">`, never typed again by hand.

## Comments

- Comment only what the code cannot say: a reason that is not obvious, a format, an order that matters.
- A module's header is one to three lines on what it owns.
- Point to at most one ADR from a file or a rule, where the decision behind it is not obvious.
- No history: no audit's finding IDs, no milestone or package tags, no dated rulings, no board codes, and no settled open point's number. The history is in the ADRs, `docs/open-points.md` and git. A test title says the behaviour it checks.
- `test/node/architecture/no-audit-ids.test.ts` fails on an audit ID in code, tests, styles or the API documents.
- `test/node/architecture/no-history.test.ts` fails on a design board's code, "Phase 1" or "Phase 2", a ruling's date or "the owner" in a comment. Name the screen instead of the board; say the rule, not who ruled.

## Keep it small

- A pull request is one batch of related work, as the owner asked: a phase of a plan, or one area of an audit's findings, rather than one a fix. It lands as a merge commit, never squashed, so each commit in it stays a step that can be reverted on its own: give each its own subject, one thing each.
- CI warns past 800 changed lines in files people wrote; generated files do not count (`.gitattributes`). A batch past it says in its description what it holds, so a reader knows where to start.
- Split a large change into steps that each leave `main` working: the migration that adds a column, then the code that writes it, then the code that reads it (`docs/migrations.md`).

## When a person must look

- A pull request that touches money or personal data (the paths in `scripts/lib/auto-merge.ts`), or updates a dependency, waits for the `reviewed` label before it merges. A new push takes the label off, so a review covers what it saw.
- Who gives the label is the owner's choice, and today it is whoever lands the pull request, after reading the whole of it once CI is green: it marks a self-review, not a second person's. Nothing checks who gave it.
- Add `hold-for-review` to hold any pull request until it is reviewed.
- Production is released only on the owner's go, by the `deploy-production` workflow (`docs/runbook.md`).

## Secrets

Never commit, print or paste a secret. A script reads one from a git-ignored `.env.<name>` file (`docs/env-files.md`); locally every vendor is a stub and no secret is needed.
