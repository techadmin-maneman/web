# 0078. The console's queues that no board draws

- Status: accepted
- Date: 2026-09-27
- Records what the console was built with in P2-F4 and #97, and what [0072](0072-ops-clients-and-queues.md) decided of it; follows [0049](0049-dpdp.md), [0065](0065-a-technicians-writes-reach-fsm.md) and [0074](0074-hand-offs-and-messages.md)

## Context

The Phase 2 front-end prompt asks for three queues the Ops Console design implies and does not draw, each "in the ops table style", and each to be recorded in an ADR:

> **No-show queue** (implied by the technician app's "goes to ops"). Each case shows the evidence: check-in time, distance, delivery receipt. Charge or waive, with a reason. Build it in the ops table style and record it in an ADR.
>
> **Two queues the design implies but does not draw:** number-change confirmations and deletion requests. Build them in the same table style and record them in an ADR.

All three are built: the no-show queue in P2-F4, on board D1's case, and the other two in #97 on 24 September 2026, with a fourth for grievances. Each was recorded in pieces — ADR 0072 for their deadlines and reasons, `docs/fidelity-method.md` ("Three sections have no board") for how they are drawn, and the open point that found them missing (`docs/open-points.md`, item 134) — but not in the ADR the prompt asks for. The audit of 24 September 2026 found it absent (REQ-13). This is it, written from what is built.

## Decision

**Four queues, each a section of the console, each read from rows the database already keeps.** Nothing is copied into a queue of its own, so a row leaves its queue when it is decided, on whichever door it was decided.

| Queue             | Routes                                                                   | A row shows                                                                                                                                                                                | Decided on the row                                                                       |
| ----------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| No-shows          | `GET /api/no-shows`, `POST /api/no-shows/:id/decision`                   | The client, the booked window, the check-in by the phone's clock and by ours, the distance or that none was measured, and what became of the reminder: delivered, sent unread, or not sent | Charge or Waive, each with a reason; a charge is asked about once more before it is sent |
| Number changes    | `GET /api/number-changes`, `POST /api/number-changes/:id/decision`       | Both numbers, the day the change was asked for, and that a code was proven on each                                                                                                         | Confirm, or Reject with a reason, which the client reads in their profile (ADR 0074)     |
| Deletion requests | `GET /api/deletion-requests`, `POST /api/deletion-requests/:id/decision` | The client's number, the day, and the days left of the seven                                                                                                                               | Delete, in two deliberate steps, or Reject with a reason                                 |
| Grievances        | `GET /api/grievances`, `POST /api/grievances/:id/resolve`                | The client's own words, their number and the day, and the time left to answer                                                                                                              | The answer ops gave, which closes it and messages nobody, as the panel says              |

**The ops table style, from the console's own parts.** Each queue is one panel at `--ops-panel` (484 px), headed by its title and its count, with a row for each waiting thing and the decision on that row, as board C1's review queue is. Ink carries the one primary action; a reason is asked for in board C1's own field; a row past its time is marked in oxblood, as board D2 marks a task that has run over. No-shows carries board D1 whole: the day's money above the queue.

**One deadline for each queue, the Tasks board's.** Each row's `due` is counted as the Tasks board counts it, from the allowance ops set (ADR 0061, ADR 0072): an erasure the seven days the client was promised, a grievance the thirty the app promises, and a no-show and a number change two days until ops set another.

**A deletion cannot be taken back, so it is the one control drawn in oxblood.** Delete opens a confirmation that writes out what is destroyed and what is kept, in the words the client's own app uses ("Invoices kept eight years, by law"), takes focus as it opens so it is read by ear as well as by eye, and offers nothing until ops confirm they have checked the request on the client's own number, which is the runbook's first step. An erasure the API refuses, because a visit is still booked or money held, says what to settle first and erases nothing (ADR 0066).

**Grievances are ours, not the prompt's.** The app promises an answer within 30 days (ADR 0049) and the grievance alert tells ops to "answer it in the ops console", so the P2-M6 proof of 23 September 2026 found a promise with no screen behind it.

**Every word is a placeholder** in `apps/ops/src/content.ts`, since no board writes any of them.

## Consequences

- Nothing in the console changes with this ADR; it records what was built against the prompt's instruction.
- There is no fidelity pair for the three client-rights queues, since there is no board to pair them with (`docs/fidelity-method.md`); the no-show queue is paired with board D1. Each is held by its browser tests — `e2e/ops/no-shows.e2e.ts`, `number-changes.e2e.ts`, `deletions.e2e.ts` and `grievances.e2e.ts`, each with axe at WCAG 2.2 AA — and by `test/worker/ops-no-shows.test.ts`, `ops-queues.test.ts` and `dpdp.test.ts`.
- The owner approves the words with the rest of the console's copy (`docs/open-points.md`, item 42), and, with counsel, the time a grievance is answered in (open point 51).
