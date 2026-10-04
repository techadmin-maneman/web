# 0065. A technician's writes reach FSM, in order, on a clock we can hold him to

- Status: accepted. Amended 4 October 2026 by [0110](0110-field-work-without-fsm.md): a technician's step is written to our own database alone; nothing reaches FSM.
- Date: 2026-09-25

## Context

The audit of 24 September 2026 found that no job worked in the technician app could ever start or close in FSM, and that the times on what it did send could not be trusted:

- **The names were wrong.** The job sheet asked FSM for transitions called "Start" and "Complete". The org calls them **"Start Work"** and **"Complete Work"**: both staging runs of 23 September 2026 took a job through Dispatch, Start Work and Complete Work in FSM's own screen (`docs/verification.md`, P2-M2). The trial had only ever listed what a _scheduled_ appointment offers — Dispatch, Cancel, Terminate and Reschedule (`docs/archive/fsm-trial.md`, question 7) — and the stub offered every name to every appointment, so no test could tell.
- **A refusal was taken as success.** `transitionAppointment` answers false for a transition FSM does not offer, and the job sheet ignored the answer, so the event was marked written. Nothing retried and nothing alerted. The appointment stayed Dispatched for good: no visit record, no photographs exported, no tax invoice for a prepaid job, no referral grant, and a client who was never "fitted".
- **The order was not kept.** ADR 0053 says a job's writes "reach FSM in the order the technician made them". The phone sends them in order; the server then put each on the fsm-sync queue as its own message, and a failed one is retried 30 seconds to 4 minutes later, so the steps behind it overtook it. The audit saw a job completed in FSM at 09:03:57 and its after photographs attached at 09:04:32. Had the photographs failed five times, the job would have closed — and been invoiced — without them.
- **The check-in's time was the phone's, unbounded.** A check-in back-dated by twenty minutes closed a no-show a fifth of a second after it arrived, and ops read the phone's time as fact one of the evidence they charge on.
- **Every other time was ours.** A job's events were stamped with the moment they reached the server, so a job done wholly offline and replayed in half a second had a duration of nothing in FSM, in the client's visit and on board D3, and a piece fitted before midnight was dated the day of the replay.
- **The server let the wrong job through.** A job moved to another day was not superseded, so an offline check-in landed on a visit the client had been told had moved; tomorrow's unlocked card took a check-in today; and a started job could still be closed as a no-show, opening a case "with the charge" on a client who was home.

## Decision

### The org's names, and what a refusal means

**The org's names, in one place.** `AppointmentTransition` in `src/providers/fsm.ts` is the list, and `transitionAppointment` takes nothing else, so a name the org does not use fails to compile. Each name is the one the evidence recorded; no other is guessed.

**A transition FSM does not offer is taken as written only when FSM is already past it.** The appointment's status is read again: Dispatched or later for Dispatch, In Progress or closed for Start Work, Completed for Complete Work, Terminated for Terminate. That is the case of ops moving a job in FSM's own screen before the phone's write arrived, and nothing of the technician's is lost. Anything else throws, so the queue retries it and alerts after the fifth attempt, as every other FSM write here does.

**The stub offers what the org offers, by status.** `STUB_TRANSITIONS` gives a scheduled appointment the trial's four, a dispatched one Start Work, one in progress Complete Work, and a closed one nothing; each transition moves the stub's appointment on. A wrong name now fails `test/worker/field-operations.test.ts`, which closes a job as done and asserts "Complete Work".

**When FSM takes a step, the mirror takes its status at once** (`src/domain/job-sheet.ts`). The board and the client's app follow the job without waiting for FSM's webhook, whose full read comes after and agrees.

### The order

**A job's writes reach FSM in the order they landed** (`src/queues/fsm-sync.ts`):

- A write whose job has an earlier write still pending does not go to FSM. It is acknowledged and waits, without spending its own attempts.
- Every write that lands sends the job's next pending one to the queue. A write that arrives twice is harmless: the second finds it written.
- A write given up on after its fifth attempt takes every pending write behind it with it, and the one alert names them all for ops to enter by hand. A write that lands later behind one given up on is refused the same way, with its own alert. FSM therefore never records a job closed without the steps before the close.
- "Before" is the order the events landed in: our clock, then the order the rows were written, since two can land in the same millisecond.

### The phone's clock

**When a write happened is the phone's to say, within bounds** (`src/policy/phone-clock.ts`). The check-in carries its own `at`; every write's `X-Client-Event-Id` is a UUIDv7, which begins with the millisecond the phone queued it (ADR 0053), so no other write needs a field for it. The server keeps that time, but never later than it received it, never earlier than the visit's booked start less 60 minutes, and never more than 24 hours before it received it. Both figures are placeholders (open point 58). **28 September 2026:** the owner kept both, and ops set them in the console (`phone_clock`, ADR 0088). A job's events keep the bounded time as `occurred_at` beside our `received_at`, so an offline replay keeps its real durations in FSM's actual times, the closing note, the client's visit and board D3, and a piece is dated the day in India it was fitted.

**A check-in keeps all three times** (migration 0035): `at`, the bounded time the wait runs from; `claimed_at`, what the phone said; and `created_at`, when we received it.

**The no-show wait runs on our clock as well as the phone's** (`src/policy/no-show.ts`). A check-in the server has held for less than the wait cannot be closed, whatever time the phone gave it: a back-dated check-in gains nothing. The price is that a check-in made with no signal starts its fifteen minutes when it reaches us. Whether that price is right is the owner's (open point 58). **The owner kept it on 27 September 2026**; its figure is the no-show wait, which ops set (ADR 0088).

**Ops see both times, and the booked window.** `GET /api/no-shows` gives each case the bounded check-in, the phone's own claim, when we received it, the booked window and how many minutes late the check-in was. Drawing them is the console's (board D1).

### The job the phone holds

- **A job moved to another time is superseded, field `time`,** like one given to another technician. A write may carry `X-Job-Starts-At`, the start the phone holds; when ops have moved the job since, the write is refused with 409 `superseded` and nothing lands. The app is to send it on every write.
- **A check-in or a start is refused on any day but the job's own** (409 `not_today`), by the bounded time of the write. That also catches a job moved to another day from a phone that does not yet send `X-Job-Starts-At`.
- **A no-show is refused once the job has started** (409 `already_started`). The close now lands before its case is opened, so a close the server refuses — started, superseded or out of order — opens no case.
- **The card carries what a phone can lose.** A job's `progress` gives the no-show wait's end and the check-in's distance, from the check-in the server holds, so a phone that lost its own copy can still close a no-show. The unlocked card gives the address whole — building, tower, floor, flat and landmark, which the client saved separately (ADR 0054) — and a visit the price book charges nothing for carries a Free badge (ADR 0025, item 33).

### The piece, and what was used

- **A replacement names the piece that came off.** The piece step takes `old_piece`, its label and why it failed, beside the new piece's label, base and supplier lot. The old one is marked failed in FSM first, then the new one becomes an asset.
- **A failure's reason reaches FSM.** FSM's asset only turns Inactive, and no field of the asset is known to hold a reason, so the reason goes on the job's summary ("Piece off: MM-STD-4417-B (…)") as well as on our copy. The mirror reads Inactive back as failed, which it did not.
- **What was used is kept row by row** in `consumables_used` once FSM has the summary that names it, where a stock count can read it. Nothing reads it yet: no board draws a stock report.

### Who may still work

- **A session ends when its technician is no longer active** (`src/http/technician-session.ts`). `active` was read only at login and a session lives 90 days from last use, so a technician who had left kept his phone's cards — clients' addresses and mobiles — for up to three months. Now his next call answers 401 `session_required`, the session is revoked, and the app wipes what it holds, as it does on any 401 (ADR 0053).
- **A technician FSM no longer lists at all is made inactive** (`syncTechnicians`). FSM's list leaves out a user whose service resource was removed, and the mirror only updated the rows it was given, so such a technician stayed active: able to log in, offered to clients and drawn on the board. The list is read nightly and on a login the mirror does not recognise. An empty list is taken as a failed read and changes nothing. **Amended 27 September 2026:** a technician written by hand into staging's database for a test is left alone (`hand_written`, migration 0046). FSM never lists him, so a read would switch off the row the owner signs in as, after which the owner's code request would answer `202` as ever and send nothing, with nothing in the log to say why; the owner found no code arriving. Each read now logs whom it made inactive, `technicians_deactivated` with their FSM IDs, and a code request that sends nothing logs `login_code_not_sent` with its reason (`src/http/send-code.ts`).

### A distance that says "not measured"

`checkins.distance_m` was NOT NULL, so a check-in at an address with no coordinate stored a filler 0 that every reader had to know to ignore, and the field test's own query did not. Migration 0035 makes it nullable by swapping the column in place — `no_show_cases` points at `checkins`, so the table is never rebuilt (migration 0031) — and clears the old fillers, which are exactly the rows that name no address. A check-in that measured nothing now holds no distance.

## Consequences

- **Terminate from Dispatched and from In Progress has not been tried on the org.** A no-show closes from Dispatched and a partial job from In Progress, both with Terminate, and the stub offers it from both. If the org does not, the write now fails loudly — five attempts and an alert — rather than silently, and the first staging job closed as a no-show or a partial will say so. The staging proof owed before production (open point 57) runs one of each.
- **A pending write whose message is lost stays pending.** Nothing re-sends a write whose own message and whose predecessor's hand-on both failed to reach the queue. It is rare — the queue send itself has to fail — and a sweep for writes pending over an hour is the remedy; it belongs with the cron's alerting (ARCH-15, INT-14), not here. **Since 25 September 2026 the sweeper re-sends it** (`src/scheduled/sweeper.ts`): a job's earliest write still pending 15 minutes after it landed, or after it was last re-sent, goes back on the fsm-sync queue, and the consumer then writes it, or gives up with its own alert. An alert on a write pending an hour is still owed with the cron's alerting.
- **The app has three new answers to meet.** `not_today` and `already_started` are new 409 codes, and `X-Job-Starts-At` is a header it should send. Until it does, the words it shows for the two codes are its generic ones, and a job moved within the same day is caught only by the day check. The technician app's own work (the audit's TEC-04, TEC-17, TEC-01 and FEA-03, app side) follows.
- The phone is otherwise unchanged: it still sends one event at a time, oldest first, and an event the server holds back answers the phone as it always did.
