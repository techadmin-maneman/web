# 0046. Moving and cancelling a visit

- Status: accepted; the late fee kept, and a credit given back only to a grant that can take it, in ADR 0068; after ops move a visit, the notice counts from its time before the move, in [0096](0096-a-no-shows-charge-and-its-dispute.md). Amended 4 October 2026 by [0110](0110-field-work-without-fsm.md): a move or a cancel is one batch in our own database; nothing is written to FSM.
- Date: 2026-09-22

## Context

P2-M5 includes "reschedule and cancel under the 24-hour policy, refunds, and late fees". The prompt's rules are in `src/policy/moving-a-visit.ts`, quoted word for word. The prompt also says:

- `POST /appointments/:id/reschedule` and `POST /appointments/:id/cancel`;
- "Each mutating route returns the consequence **before** the client confirms";
- both sit behind `SELF_SERVE_BOOKING`.

The designs draw boards C7 (reschedule, both versions) and C8 (cancel, more than 24 hours out, and inside 24 hours for a credit booking).

FSM, tried on the real org on 22 September 2026 (`docs/archive/fsm-trial.md`):

- An appointment moves through `PUT /Service_Appointments/{id}/actions/reschedule`, with the same ID.
- A work order cancels through its blueprint's "Cancel" transition, which requires a note. That cancels its appointment too.
- There is no plain cancel action.

## Decision

**The notice** is counted from the start of the visit's window, not from its half-slot. More than 24 hours before, a change is free; after that it is late. **Amended 29 September 2026** ([0096](0096-a-no-shows-charge-and-its-dispute.md)): after ops move a visit, it is counted from the window the visit had before they moved it, where that is later, as the owner ruled (`docs/open-points.md`, item 71). The terms are worked out when the client asks for them, and again when a hold for a move is made.

**What each change costs** (`moveCost`, `cancelRefund`):

| Visit                  | Move, free                     | Move, late                                                         | Cancel, free     | Cancel, late                              |
| ---------------------- | ------------------------------ | ------------------------------------------------------------------ | ---------------- | ----------------------------------------- |
| Consultation           | free                           | free                                                               | nothing to pay   | nothing to pay                            |
| Service visit          | free; the payment carries over | charged: the payment is kept, and the new visit is paid separately | refunded in full | charged: the payment is kept              |
| First fit, replacement | free; the payment carries over | the late fee is paid now, and the payment carries over             | refunded in full | the payment less the late fee is refunded |

The late fees are the price book's `late_fee_first_fit` and `late_fee_replacement`, as they stood when the visit was booked: the hold that booked it keeps its late fee (ADR 0068). When ops move a visit, the client is never charged (`moveCost(..., "ops")`, for dispatch in P2-M4). A visit paid with a credit gets it back when changed more than 24 hours out and loses it inside them (`creditOnChange`); a grant clawed back or expired takes nothing back (ADR 0068).

**The routes** (`src/routes/client-changes.ts`):

- `GET /api/appointments/{id}/reschedule` answers the terms (until 5 October 2026 a `POST` with `{}`, which made one call answer two shapes):
  - the notice;
  - `free_until`;
  - what the payment holds;
  - the cost (`free`, `late_fee` or `charged`);
  - the price paid now to move.
- `POST /api/appointments/{id}/cancel` with `{ confirm: false }` answers the terms: what goes back, and what is kept. With `{ confirm: true, notice }` it cancels. The notice is the one the client was shown; if it has changed since (the 24 hours ran out), the route answers `409 terms_changed` and the app shows the new terms.
- A visit that has started, has passed, is another client's, has no work order in FSM, or (for a move) has no technician yet, answers `409 not_changeable`. The app then offers WhatsApp to ops.

**A move is a hold.** The client picks the new time as a booking does, through `GET /api/availability` and `POST /api/holds`, with `moving` set to the visit:

- The hold is priced at what the move costs now: nothing, the late fee, or the new visit's price on its day.
- `POST /api/appointments/{id}/reschedule` with the hold starts it, exactly as `POST /api/bookings` does: Checkout when there is something to pay, or the queue at once when free.
- **A move in place** (free, or once its late fee is paid) keeps the visit's technician. The FSM appointment keeps its ID and is rescheduled; the mirror moves its times, and its payment stays with it. A late fee is a payment of kind `late_fee` on the same visit. Availability for a move offers only that technician, and leaves the visit's own time out of the day. Moving to another technician is dispatch's (P2-M4).
- **A charged move** (a service visit inside 24 hours) is a new booking, with any technician. Once it is booked, the old work order is cancelled in FSM with a note, and the old visit's payment is kept as the charge. If FSM fails to cancel it, the queue's next try does it; if FSM refuses, the old visit is left as FSM has it and ops are told to cancel it by hand (ADR 0068).
- If the visit has started or gone by the time the move is confirmed, what was paid for the move is refunded in full, as for a lapsed hold (ADR 0045).

**A cancel** (`src/domain/visit-changes.ts`):

1. The change is claimed first, in `visit_changes` (migration 0020), where a visit can end once. A repeated request cannot cancel or refund twice.
2. FSM cancels the work order, with a note saying who cancelled and at what notice.
3. The mirror marks the visit cancelled.
4. Razorpay refunds what the terms give back, to the payment's source.

If FSM fails, the claim is let go and nothing has changed (`503 unavailable`). Where our own database holds the visit, steps 1 to 3 are one batch, so the same holds if it fails.

Once the visit is cancelled it stays cancelled, whatever fails after:

- A refund Razorpay refuses, or will not say it made, is left to ops, who are alerted to refund it by hand.
- A refund the request could not ask for, or could not record, answers `202` with `refund_pending: true`. The app says the refund is on its way. At its first quarter-hourly run from ten minutes on, the cron's `cancel_refunds` job (`src/domain/cancel-refunds.ts`) asks for it again under the cancel's receipt, so Razorpay makes it once ([0100](0100-a-refund-is-made-once.md)). `visit_changes.refund_settled_at` stays empty until then. The job also finds a cancel whose Worker stopped before its refund. The request may have made the refund, so a refusal the job hears is told to ops as a refund that may have been made: look in Razorpay before refunding by hand.
- A message the queue refuses is sent by the sweeper.

Where FSM holds the visit, a failure after FSM has cancelled still answers `503`, and the visit's credit is not given back; the job refunds its payment once the mirror shows it cancelled. FSM is being removed, so that path is left as it is.

**Every change is kept** in `visit_changes`: its kind (moved, replaced, cancelled), its notice, when the visit was to start and now starts, and what was refunded and kept. A kept payment is a charge. `GET /api/payments` gives it `charge: { change, at, visit_started_at, amount }`, and the app shows the design's evidence line ("cancelled 9:14 am, visit was 10 am"). A payment also says what it paid for, `purpose: visit | late_fee`.

**The app** (`apps/app/src/booking/ChangeSheet.tsx`):

- Home's Reschedule opens C7, with the terms.
- Pick a new date (or Move and accept charge) goes on to the booking sheet's date and window steps, then pays what the move costs.
- C7 also offers "Cancel the visit instead", which opens C8. The design draws C8 but not the way to it; this is a placeholder (`docs/open-points.md`, item 7).

## Consequences

- A client can move or cancel any visit FSM has a work order for, including those ops booked, while self-serve booking is on. A visit with nothing paid is moved or cancelled at no cost.
- The late-cancel refund of a first fit or a replacement (the payment less the late fee) is our reading of "with the balance carried over". The owner confirms it (`docs/open-points.md`, item 7).
- Messages confirming a move or a cancel arrive with the Phase 2 messages.
