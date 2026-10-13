# 0189. The Staff list on by default

- Status: accepted
- Date: 2026-10-13
- Topic: The ops console

## Context

The Staff list (ADR 0109) was seeded switched off, and a database without its row read as off. Each environment depended on someone switching it on by hand; until then everyone Access lets in can refund, waive, set prices and erase. Production's first release creates the list empty and off.

## Decision

1. **On by default.** Migration 0156 switches the list on wherever it is off, and a database without the switch's row reads as on.
2. **Bootstrap admins.** `STAFF_BOOTSTRAP_ADMINS`, a comma-separated list of emails set per environment in `wrangler.jsonc`, names the people who hold every department at Manage, nationally, whatever the list holds. They reach a new environment's console to fill its list; nobody else does until listed.
3. **Off stays possible,** on Admin › Staff, as before: a deliberate act, audited, never a default.

## Consequences

- Locally the stub identity, `ops@localhost`, is a bootstrap admin, so a laptop's console works on a fresh database.
- Worker tests that were written for the old default switch the list off themselves (`relax` in `test/worker/ops/staff-fixtures.ts`).
- Tests: `test/worker/ops/staff-access.test.ts`.
