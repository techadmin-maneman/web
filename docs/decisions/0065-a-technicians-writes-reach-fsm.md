# 0065. A technician's writes reach FSM, in order

- Status: accepted
- Date: 2026-09-25

## Context

The audit of 24 September 2026 found that no job worked in the technician app could ever start or close in FSM:

- **The names were wrong.** The job sheet asked FSM for transitions called "Start" and "Complete". The org calls them **"Start Work"** and **"Complete Work"**: both staging runs of 23 September 2026 took a job through Dispatch, Start Work and Complete Work in FSM's own screen (`docs/verification.md`, P2-M2). The trial had only ever listed what a _scheduled_ appointment offers — Dispatch, Cancel, Terminate and Reschedule (`docs/decisions/fsm-trial.md`, question 7) — and the stub offered every name to every appointment, so no test could tell.
- **A refusal was taken as success.** `transitionAppointment` answers false for a transition FSM does not offer, and the job sheet ignored the answer, so the event was marked written. Nothing retried and nothing alerted. The appointment stayed Dispatched for good: no visit record, no photographs exported, no tax invoice for a prepaid job, no referral grant, and a client who was never "fitted".
- **The order was not kept.** ADR 0053 says a job's writes "reach FSM in the order the technician made them". The phone sends them in order; the server then put each on the fsm-sync queue as its own message, and a failed one is retried 30 seconds to 4 minutes later, so the steps behind it overtook it. The audit saw a job completed in FSM at 09:03:57 and its after photographs attached at 09:04:32. Had the photographs failed five times, the job would have closed — and been invoiced — without them.

## Decision

**The org's names, in one place.** `AppointmentTransition` in `src/providers/fsm.ts` is the list, and `transitionAppointment` takes nothing else, so a name the org does not use fails to compile. Each name is the one the evidence recorded; no other is guessed.

**A transition FSM does not offer is taken as written only when FSM is already past it.** The appointment's status is read again: Dispatched or later for Dispatch, In Progress or closed for Start Work, Completed for Complete Work, Terminated for Terminate. That is the case of ops moving a job in FSM's own screen before the phone's write arrived, and nothing of the technician's is lost. Anything else throws, so the queue retries it and alerts after the fifth attempt, as every other FSM write here does.

**The stub offers what the org offers, by status.** `STUB_TRANSITIONS` gives a scheduled appointment the trial's four, a dispatched one Start Work, one in progress Complete Work, and a closed one nothing; each transition moves the stub's appointment on. A wrong name now fails `test/worker/field-operations.test.ts`, which closes a job as done and asserts "Complete Work".

**When FSM takes a step, the mirror takes its status at once** (`src/domain/job-sheet.ts`). The board and the client's app follow the job without waiting for FSM's webhook, whose full read comes after and agrees.

**A job's writes reach FSM in the order they landed** (`src/queues/fsm-sync.ts`):

- A write whose job has an earlier write still pending does not go to FSM. It is acknowledged and waits, without spending its own attempts.
- Every write that lands sends the job's next pending one to the queue. A write that arrives twice is harmless: the second finds it written.
- A write given up on after its fifth attempt takes every pending write behind it with it, and the one alert names them all for ops to enter by hand. A write that lands later behind one given up on is refused the same way, with its own alert. FSM therefore never records a job closed without the steps before the close.
- "Before" is the order the events landed in: our clock, then the order the rows were written, since two can land in the same millisecond.

## Consequences

- **Terminate from Dispatched and from In Progress has not been tried on the org.** A no-show closes from Dispatched and a partial job from In Progress, both with Terminate, and the stub offers it from both. If the org does not, the write now fails loudly — five attempts and an alert — rather than silently, and the first staging job closed as a no-show or a partial will say so. The staging proof owed before production (open point 76) runs one of each.
- **A pending write whose message is lost stays pending.** Nothing re-sends a write whose own message and whose predecessor's hand-on both failed to reach the queue. It is rare — the queue send itself has to fail — and a sweep for writes pending over an hour is the remedy; it belongs with the cron's alerting (ARCH-15, INT-14), not here.
- The phone is unchanged: it still sends one event at a time, oldest first, and an event the server holds back answers the phone as it always did.
