# 0189. The Staff list on by default

- Status: accepted
- Date: 2026-10-13
- Topic: The ops console

## Context

The Staff list (ADR 0109) was seeded switched off, and a database without its row read as off. Each environment depended on someone switching it on by hand; until then everyone Access lets in can refund, waive, set prices and erase. Staging has been on since 26 May 2026. Production's first release creates the list empty and off, and switching it on then would leave nobody able to fill it.

## Decision

1. **On without a switch.** A database without the switch's row reads as on.
2. **Not by a migration.** The code already deployed reads the switch as soon as a migration runs, and has no bootstrap admins, so a migration that switched it on would refuse everyone not yet listed until the new Worker went live, and again on a rollback. CI's "deployed code on these migrations" check fails on exactly that. Production is switched on at Admin › Staff once its first release is live (`docs/go-live.md`).
3. **Bootstrap admins.** `STAFF_BOOTSTRAP_ADMINS`, a comma-separated list of emails set per environment in `wrangler.jsonc`, names the people who hold every department at Manage, nationally, whatever the list holds. They reach a new environment's console to fill its list; nobody else does until listed.
4. **Off stays possible,** on Admin › Staff, as before: a deliberate act, audited.

## Consequences

- Locally the stub identity, `ops@localhost`, is a bootstrap admin, so a laptop's console works with the list on.
- A fresh database from the migrations still has the list off, as the tests expect; `enforce` in `test/worker/ops/staff-fixtures.ts` switches it on.
- Tests: `test/worker/ops/staff-access.test.ts`.
