# Shipping a change

One page on getting a change from your laptop to staging. `README.md` says what the platform is, `docs/README.md` finds every other document, and `docs/getting-started.md` runs it all locally.

## Start to finish

1. **Branch from `main`:** `git switch -c booking-ten-minute-hold`.
2. **Open a draft pull request early:** `gh pr create --draft`. Title it `<area>: <what changes>`, in 72 characters or fewer, as `booking: hold a window for ten minutes while the client pays`. The area is a folder or a product word: `booking`, `site`, `ops`, `tech`, `docs`, `ci`.
3. **Make the change, with its tests.** A rule goes in `src/policy/`, its effect in `src/domain/`, its route in `src/routes/` (README, "Layout"). Every bug fixed gets the test that would have caught it.
4. **Keep the comments true.** When you change code, read the comment beside it and fix it or delete it (below, "Comments").
5. **Check before you push:**
   - `npm run typecheck && npm run lint && npm run format:check`;
   - the tests beside what you changed: `npx vitest run test/worker/bookings.test.ts`;
   - for a screen you changed, its browser tests, after building it: `npm run build:app -- --env local && npx playwright test e2e/app/booking.e2e.ts`;
   - after changing a route's schema, a migration, a binding or an ADR's status, `npm run gen`. CI fails until the generated files match.
6. **Mark it ready.** CI runs every check on each push. A ready pull request from this repository merges itself once CI passes, and its merge deploys to staging.

## Comments

- Comment only what the code cannot say: a reason that is not obvious, a format, an order that matters.
- A module's header is one to three lines on what it owns.
- Point to at most one ADR from a file or a rule, where the decision behind it is not obvious.
- No history: no audit's finding IDs, no milestone or package tags, no dated rulings, no board codes, and no settled open point's number. The history is in the ADRs, `docs/open-points.md` and git. A test title says the behaviour it checks.
- `test/node/no-audit-ids.test.ts` fails on an audit ID in code, tests, styles or the API documents.

## Keep it small

- One change a pull request, and never several squashed into one: each should be revertable on its own.
- Aim for under 800 changed lines in files people wrote. CI warns past that; generated files do not count (`.gitattributes`).
- Split a large change into steps that each leave `main` working: the migration that adds a column, then the code that writes it, then the code that reads it (`docs/migrations.md`).

## When a person must look

- A pull request that touches money or personal data (the paths in `scripts/lib/auto-merge.ts`), or updates a dependency, waits for the `reviewed` label before it merges. A new push takes the label off, so a review covers what it saw.
- Add `hold-for-review` to hold any pull request until it is reviewed.
- Production is released only on the owner's go, by the `deploy-production` workflow (`docs/runbook.md`).

## Secrets

Never commit, print or paste a secret. A script reads one from a git-ignored `.env.<name>` file (`docs/env-files.md`); locally every vendor is a stub and no secret is needed.
