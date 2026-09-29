# 0095. A booking FSM refuses is held, not refunded

- Status: accepted, on the owner's ruling of 27 September 2026 (`docs/open-points.md`, item 141)
- Date: 2026-09-29
- Supersedes the give-up of [0068](0068-a-paid-hold-is-kept.md), whose fifth refusal refunded the client; amends [0088](0088-every-policy-in-the-console.md), adding a setting to its register; records decisions for the owner to confirm in ADR 0025 (items 80 to 83)

## Context

ADR 0068 kept a paid hold's time however long FSM took, but not past FSM's fifth refusal running. The queue tries a write again after 30 seconds, then 1, 2 and 4 minutes, so the fifth refusal came about eight minutes after the first, and it cancelled what FSM held for the booking, refunded the client and told ops what happened to the money. A short outage at Zoho, such as the token exhaustion of item 32, refunded every client who paid during it and lost them their slots; the P2-M2 proof did exactly that to three bookings (`docs/verification.md`).

The owner ruled on 27 September 2026: "hold it and alert ops". After the fifth refusal the slot and the payment are kept and ops are alerted once; the queue keeps trying hourly for 24 hours; ops book it in FSM or refund it from the console (`docs/owner-answers-2026-09-27.md`).

## Decision

### Held, with its slot and its payment

The fifth refusal running holds the booking for ops (`holdForFsm`, `src/domain/held-bookings.ts`): `slot_holds.fsm_held_at` records when, and `fsm_refusal` FSM's latest reason, as the log gives it (migration 0058). Nothing is cancelled in FSM and nothing is refunded. The hold stays `held` and confirmed, so the clash check that booking and dispatch share still counts its time and nobody else is sold it (ADR 0068), and the payment stays as Razorpay captured it. It is a column rather than a new state, for ADR 0068's reason: the state's CHECK cannot change without rebuilding `slot_holds`.

Ops are told once, by the alert webhook as every money alert is (`alertOnce`, key `booking_held:<hold>`, ADR 0067), with the reason, that nothing is refunded, how often and how long it will be tried, and a link to the client's Visits tab. A later refusal is not told again.

### Tried every hour for 24 hours, by the cron

Cloudflare Queues cannot delay a message past 12 hours, and a message retried by the queue counts attempts of its own, so the cron drives the hourly tries, as it already put back a paid hold the queue lost (ADR 0068). The `unbooked_holds` job, every five minutes, puts each held booking back on the fsm-sync queue once an interval has passed since its last try, while it is inside its tries and its visit is still to come (`retryHeldBookings`; the rule is `dueAnotherTry`, `src/policy/held-bookings.ts`). Each is one try: a held booking that fails again is not retried by the queue, and waits for the next hour. A try that lands books it exactly as the first would have, on the same lease and the same kept work order and appointment IDs, so FSM is never written twice, and the client is told as they would have been. After the tries end, or once its visit's time has come, it is not tried again, and waits for ops.

**The figures are a console setting** (`fsm_retry`, Settings · Rules), under the owner's standing rule that every policy is an ops update (ADR 0088): tried again every 1 hour (1 to 12), for 24 hours from the fifth refusal (1 to 168). The rule keeps the owner's words in `src/policy/held-bookings.ts`, with `test/node/policy-held-bookings.test.ts` quoting them.

**What a held booking keeps.** ADR 0088's principle stands: a hold keeps what it was sold under, so a booking made a day late still carries the notice, the charges, the late fee and the grace it was sold under, whatever ops set meanwhile (`test/worker/held-bookings.test.ts`). The retry figures are not among them. They decide when FSM is asked, not money the client pays or loses, so, like the reminder's hour, they are read when used: a change reaches the bookings already waiting at their next try, counted from the fifth refusal each keeps.

**What it costs.** Almost every run finds nothing held, so the job asks first whether anything is (one row on `slot_holds_confirmed`'s partial index) and reads nothing more. The figures ops set are read once a run and shared by the jobs that use them (`CronContext.inputs`), which the two reminder jobs had read separately, so the evening run, which sat at the quiet-run ceiling of 100 rows, reads the same 100 (`test/worker/cron-reads.test.ts`). A run puts back at most 20 held bookings, each a queue send and an update: inside the 1,000 internal calls, and no outside call (ADR 0093).

### Where it waits, and what ops do

**On the Tasks board, "Booking not in FSM"** (`held_booking`), from the fifth refusal until it is booked or refunded, due in 24 hours (a placeholder, as every group's is) and by the start of its visit's day at the latest. The payments board, D1, was the other place the brief named; the console does not draw it (No-shows stands where the design draws Payments), and the Tasks board already has owners, allowances and a way to the client, so the task leads to the client's Visits tab.

**On the client's Visits tab**, at its head: the booking's visit, what was paid, what FSM said, and until when it is tried, with three actions (`src/routes/ops-bookings.ts`, each audited in the batch that makes its change, ADR 0031):

- **Try FSM again** (`POST /api/held-bookings/{id}/retry`, `booking.retry`): the hourly try, now. It books it as the queue would, or says what FSM said. Refused once the visit's time has passed.
- **Link the visit booked in FSM by hand** (`POST /api/held-bookings/{id}/link`, `booking.link`). "Ops book it in FSM" can mean ops booking it in FSM's own screens, at the same time or at another agreed with the client. FSM's webhook, or the reconciliation, then mirrors that appointment as a visit of the client's with no booking behind it. Ops choose it from the client's visits of the booking's kind still to come, and the booking is booked as that visit: its payment and tier move to it, its credit is spent, the client is told as a booking tells them, and its claim on the slot goes. Nothing is made twice: a work order an earlier try left for the booking, other than the visit's own, is cancelled in FSM, and the answer says so, or that FSM would not cancel it. A visit another booking already holds, another client's, or one done is refused. A booking that moves a visit is not linked; trying FSM again moves it.
- **Refund** (`POST /api/held-bookings/{id}/refund`, `booking.refund`), after a check that says what it does: what `giveUpOnBooking` did on the fifth refusal before. The work order FSM holds for it is cancelled first, so no technician goes, then the payment is refunded in full and the slot let go, and the client is told on WhatsApp. The answer says what happened to the money and to FSM. Razorpay refusing the refund changes nothing: the booking still waits, and the answer says to try again or to refund it in Razorpay's dashboard.

Each of the three takes the hold's lease first, as the queue's try does (ADR 0068), so an hourly try and an action of ops' at the same moment cannot both write it; the one that finds the lease taken answers `409 superseded`, and the console says to look again in a minute. A refund Razorpay refuses after the work order was cancelled leaves the booking waiting with no work order, so its next try makes a fresh one rather than booking on the cancelled one.

A try FSM refuses, and a refund Razorpay refuses, change nothing in D1, so they are recorded only as the call every ops request is (`ops.call`). The refund changes FSM and Razorpay before its batch, so it is left out of `test/worker/audit-with-action.test.ts`; a try and a link are in it.

### What the client sees and is told

- **The booking sheet** is as before: it waits a minute, then says "This is taking longer than usual. We will message you on WhatsApp when the visit is booked."
- **Home**, while a visit paid for (or booked free) waits for FSM and nothing else is next, shows its day, window and kind with the sheet's own words: "Your payment is in. We are booking your visit." and "We will message you on WhatsApp when the visit is booked." (`GET /api/me`, `being_booked`). It never says the visit is booked, nor that the money is gone. For a free booking, "We are booking your visit." is a placeholder.
- **Payments** lists the payment as paid, as it is, with no visit yet.
- **Booked**, by a try or by ops' link, the client gets the booking's own message.
- **Refunded** by ops, the client gets a new message, `booking_refunded`, about the hold: the visit, its day, and the money on its way back, or, for a free or credit booking, that it could not be booked. Placeholder texts (`booking_refunded_v1`, `booking_not_made_v1`), sent only with the client's consent to WhatsApp about their visits, as every message about a visit is.

## For the owner to confirm (ADR 0025, items 80 to 83)

- A free booking FSM refuses (a consultation, or one a credit covers) is held too. The ruling spoke of a paid booking; before it, a free one was let go silently, and the client never told.
- Each hourly try is one try, not five; and a booking is not tried once its visit's time has come.
- Where it waits, and what "ops book it in FSM" means: the Tasks board and the client's Visits tab, with the three actions above.
- What the client sees and is told, above; the new words are placeholders.

## Consequences

- Migration 0058: `slot_holds.fsm_held_at` and `fsm_refusal`, both empty on every hold there is; the Worker deployed before reads and writes neither, and a hold it gives up it releases, which nothing reads as held.
- The contract: three ops routes; `held_bookings` on `GET /api/clients/{id}`; `being_booked` on `GET /api/me`; `held_booking` among the task groups; `fsm_retry` among the settings.
- The register holds fifteen inputs.
- The alert `booking_given_up` is no longer raised; `booking_held` replaces it, and the runbook's "A booking FSM would not take" says what to do.
- A long outage no longer refunds anybody. Every booking made during it waits, holding its slot; for one longer than a day, ops still switch self-serve booking off (runbook, "FSM is down").
