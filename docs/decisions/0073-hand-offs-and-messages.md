# 0073. What each person learns when something changes for them

- Status: accepted
- Date: 2026-09-26
- Amends [0047](0047-visit-messages.md), [0048](0048-referrals.md), [0062](0062-leave-on-the-dispatch-board.md) and [0063](0063-the-asked-window.md); follows [0067](0067-alerts-and-silent-failures.md), [0070](0070-vendor-correctness.md) and [0072](0072-ops-clients-and-queues.md)

## Context

The audit of 24 September 2026 followed each change through every surface it should reach, and found many that stopped at the first:

(Filled in below as the package lands.)

## Decision

**A no-show is recorded as one** (BIZ-21). A visit the technician closed as a no-show was stored as a partial visit whose reason said so, and read as partial everywhere. `visits.outcome` now takes `no_show` (migration 0043, which rebuilds `visits`: nothing points at it), the mirror writes it from the job's own outcome event, and the rows already stored as partial no-shows became no-shows.

**A visit left partly done is a task** (BIZ-21). The prompt: "ops need the full set because these drive the task queue". A partial visit now waits on the Tasks board as **Visit left partly done**, with the technician's reason, from when he closed it, until the client has another visit booked after it to finish what was left. It takes the default two days. There is no "no follow-up needed" mark: like a replacement falling due, the task goes when the thing is done, and a client who wants no follow-up keeps it on the board until the owner says otherwise (`docs/open-points.md`, item 58).

## Consequences

- Migration 0043 rebuilds `visits` with a wider CHECK, copying every row. The Worker already deployed still writes a no-show as `partial` with the reason `no_show`, which the new CHECK takes, and the next sync of that visit makes it a no-show.
