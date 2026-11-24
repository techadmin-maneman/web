# 0315. A remedy past the limit, given by one who may approve it

- Status: accepted
- Date: 2026-11-24
- Topic: Messages and the CRM
- Amends [0143](0143-remedies.md), decision 3

## Context

ADR 0143 holds a remedy above Care's limit for a Customer Care manager to approve. An admin gave a client a second
free visit from their chat, past the limit, and it sat awaiting approval: the admin's own, since an admin is a manager
of every department. Its task told them to decide in Messages, where nothing decides it. The owner then ruled, on 24
November 2026:

- tasks and actions are never kept only in Settings;
- a remedy given past the limit is marked as such in Activity.

## Decision

1. **One who may approve a remedy gives it past the limit at once.** That is a national Customer Care manager, or an
   admin, by their own grants (`grants()` in `src/http/staff-access.ts`), whether or not the Staff list is enforced.
   Their giving is their approval: the remedy is recorded as decided by them, then and there. Anyone who may only act
   still sends a remedy past the limit for approval, as before.
2. **A remedy awaiting approval is decided from its task's drawer** (`apps/ops/src/tasks/RemedyDecision.tsx`), with
   Approve and Decline, as a technician's ask for leave is. Settings' Remedies still lists it, but the task no longer
   sends anyone there, nor to Messages.
3. **Activity says when a remedy was given past the limit.** The audit entry's detail carries `past_limit: true`, and
   Activity reads "gave a remedy past the limit".

## Consequences

- No section's badge counts a remedy awaiting approval: it waits on Tasks alone.
- `docs/how-it-works/care.md` says the same.
- Tests: `test/worker/care/remedies.test.ts`, `test/node/apps/ops/activity-sentences.test.ts`,
  `e2e/ops/tasks-decisions.e2e.ts`.
