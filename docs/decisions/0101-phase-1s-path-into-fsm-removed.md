# 0101. Phase 1's path into FSM is removed, and no booking carries a Request

- Status: accepted, on the owner's ruling of 1 October 2026
- Date: 2026-10-01
- Amends [0032](0032-fsm-mirror.md), [0063](0063-the-asked-window.md) and [0064](0064-converting-a-request.md); closes the plan's C4 (`docs/open-points.md`, items 33 and 159)

## Context

Phase 1's `POST /api/lead` sent a booked lead to FSM as a Request, for ops to convert to a work order there (ADR 0032). The route was removed on 28 September 2026 (#152), and what sent its leads stayed for a lead it had left waiting, to go "a day after the release that removed the route on staging, and at once in production, whose FSM was never on" (open point 159):

- `src/domain/fsm-leads.ts`;
- the fsm-sync queue's `lead_id` message, and the sweeper's late send of one;
- the FSM provider's `createRequest`, `findRequest` and `requestPreference`;
- the asked-window pass's read of a visit's Request, and of the lead behind it (ADR 0063).

The owner had ruled on 27 September 2026 that each booking's work order carry its Request, so FSM moves the Request on by itself (open point 33; the plan's C4). Every booking since #152 is made as a work order from its held slot, and none has a Request to carry. Production's FSM was never on, and staging's three Requests were deleted with its other records on 1 October 2026 (open point 19).

## Decision

**C4 is closed: no booking has a Request, so there is none to link.** The owner ruled so on 1 October 2026.

**Phase 1's path into FSM is removed.** `src/domain/fsm-leads.ts`, the `lead_id` message and its consumer, the sweeper's late send, and the provider's three Request calls are gone. A `lead_id` message left in the fsm-sync queue is acknowledged and logged as one it does not know.

**The asked-window pass reads only D1.** A consultation takes the window of the client's latest consultation request, which the site's form keeps while self-serve booking is off (ADR 0074); any other visit is marked looked-at with none. The pass makes no outside call, so it takes nothing from the cron run's budget.

**The leads' columns wait for a contract migration.** `fsm_request_id`, `fsm_request_tried_at` and `fsm_queued_at` are no longer read or written; `appointments.asked_failed_at` is no longer written. Dropping them now would break the Worker still serving while this release rolls out, so they go in a later release. `first_choice_window` stays: the proposed visit, the lead's notice and the CRM sync read it.

## Consequences

- Nothing of ours makes, finds or reads a Request in FSM. Ops who create a Request in FSM's own screen convert it there, as before; the pass does not read it.
- The asked-window pass no longer fails on FSM, so no visit waits an hour for it.
- Tests: `test/worker/asked-windows.test.ts` is rewritten for the D1-only pass; `fsm-leads.test.ts` and the sweeper's, FSM provider's and replies' Request tests are removed.
