# 0067. A paid hold is kept

- Status: accepted
- Date: 2026-09-25
- Amends [0044](0044-payments-mirror.md), [0045](0045-self-serve-booking.md) and [0046](0046-moving-and-cancelling.md); follows [0057](0057-one-payment-per-tap.md)

## Context

The audit of 24 September 2026 ran the money path against the real code, one scenario at a time (W1 to W10), and found a client who paid could lose the visit, the money, or both, and that nobody would be told:

| Scenario                                                                 | Before                                                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| W1: paid at 9:50 into the countdown, the webhook lands at 10:05          | Refunded, slot lost: the lapse was judged on when the webhook arrived                                  |
| W2: paid at 5:00, FSM refuses once, another client holds after 10:00     | The paid hold is let go by the other client's hold, then refunded on the retry                         |
| W3: someone types the client's number into the site's form               | The client's paid hold is let go, and the client renamed                                               |
| W4: a credit-covered move inside 24 hours, FSM fails the old cancel once | The new visit is booked, but the credit is never spent and the client never told                       |
| W9: `order.paid` and `payment.captured` for one payment                  | The booking is queued twice; two consumers at once would book FSM twice                                |
| W10: FSM refuses five times, then Razorpay refuses the refund            | The error escapes the queue handler: no alert, no ack, the rest of the batch skipped, nothing refunded |

And, around it: a timeout after FSM took a work order made a second one on the retry (INT-01, BIZ-05); the Payments tab split every payment at 0% GST whatever it was sold at (BIZ-07); a clawed-back credit came back through a free cancel (BIZ-11); the site booked a second consultation for a number that had one, and a consultation for a client long past one (CLI-02, BIZ-03); days ops had blacked out were bookable and paid for (BIZ-25).

## Decision

**A hold the client has paid for is confirmed, and kept.** `slot_holds.confirmed_at` (migration 0038) is set by the capture webhook, from Razorpay's own time for the payment, or when a free visit is booked. A confirmed hold keeps its time until it is booked or refunded, however long FSM takes: no other hold lets it go, the client can no longer let it go, and the clash check that booking and dispatch share counts it. It is a column rather than a new `state`: the state's CHECK cannot change without rebuilding `slot_holds`, which other tables reference (migration 0025 was withdrawn for that).

**A payment is in time by Razorpay's clock.** It counts if Razorpay made it no later than `PAYMENT_GRACE_SECONDS` (120) after the hold's ten minutes, whenever its webhook reaches us. An unpaid hold keeps its time for the same two minutes after its countdown, so a payment begun at 9:59 still finds its slot. A later payment is refunded, as before.

**FSM is written once, however often a booking is tried.**

- Only `payment.captured` queues a booking. `order.paid` says the same of the same payment, and records it only.
- A consumer takes the hold's lease (`booking_until`, five minutes) before it writes to FSM. Another finds it taken, answers `being_booked`, and tries again later, which never counts toward giving up.
- A visit is two creates: the work order, then its appointment on the work order's service line. Each ID is kept on the hold the moment FSM gives it, and a retry reuses it.
- The work order's summary ends "(booking _hold ID_)". A retry after a try that reached FSM and never heard back (`fsm_tried_at`) looks for it among FSM's latest work orders before making another. A work order made on an earlier try has its appointment looked for among FSM's latest appointments, the read the reconciliation already makes; FSM refuses a second appointment on one service line anyway (`docs/decisions/fsm-trial.md`).
- A lead's Request carries "(lead _lead ID_)" and is looked for the same way (`leads.fsm_request_tried_at`). A contact is looked for by mobile number before one is added, which also finds one ops added by hand.
- A look FSM cannot answer is logged and the record made as before. For a work order, ops are also told to look for a second one.

**What follows a booking happens once, and always.** The credit spent, the confirmation queued, the replaced visit cancelled: each runs after the booking and again for every later message about it, and each that already happened changes nothing (the ledger's one-use index, one confirmation per visit and kind, and `visit_changes`' one end per visit). A cancel FSM refuses leaves the replaced visit as FSM has it, and ops are told to cancel it by hand.

**Giving up tells the truth.** On the fifth failure the work order FSM holds for the booking is cancelled first, so no technician goes to a visit whose money went back; then the payment is refunded; then ops are told the Razorpay payment, the amount and what is left in FSM, from what actually happened. Razorpay refusing the refund never escapes the queue handler: the message is acknowledged, the hold stays confirmed and keeps its time, and ops are told to refund it by hand if the alert comes again.

**A cron pass puts back what went quiet.** The `unbooked_holds` job puts a confirmed hold still neither booked nor refunded half an hour after it was queued back on the queue, and tells ops. That covers a queue message lost and a refund refused. There is no dead-letter queue: the hold row is already the durable record, a second copy of it would be a second thing to reconcile, and a dead-letter queue is a new queue the account would have to create before any deploy.

**The site's forms need only a number, so they are held to it.** `/api/consultation` and `/api/r/:code/*`:

- never rename the person the number belongs to (nor does the Phase 1 lead form, which wrote the same row);
- never let go of a hold made in the app;
- write the person, their consent and the hold in one batch, so a window that has gone leaves nothing behind;
- answer `409 already_booked`, with the date and window, for a number with a consultation still to happen, and `422 not_bookable` for one past consultations, who books in the app;
- book a consultation only on a day the price book has it free; on any other, it waits for ops as a request, as it does while self-serve booking is off.

**One consultation and one first fit at a time.** `bookableTypes` leaves out a consultation or a first fit while one is booked or paid for, and starting to pay for a hold checks again.

**What a client was sold stays sold.** A hold keeps the late fee it was made under, and a visit's move and cancel terms read it from the hold that booked it. A payment keeps the figure before GST and the rate its hold charged (`payments.amount_ex_gst`, `gst_percent`), and the Payments tab shows those; only a payment no hold priced is split at `GST_PERCENT`. Availability prices each day at the price in force on it.

**Credits.** A free cancel gives a credit back only to a grant that can still take it: not one clawed back or expired (`creditOnChange`, `src/policy/moving-a-visit.ts`). A credit lasts to the end of the day in India it is shown to expire on. Ops put a balance right by hand with `POST /api/clients/{id}/credits`, audited as `credit.adjust` in the same batch. An invite held on a waitlist that lapsed 12 months after its area launched is marked expired when its friend books, and the booking's answer says `invite: "expired"` with no credits.

**Blackouts.** A day in `visit_blackouts` is offered to nobody and held for nobody, in the app or from the site.

## Not yet tried on the org

Three reads and one field have not been tried against the real org, since this change could not reach it:

- `GET /fsm/v1/Contacts/search?criteria=(Mobile:equals:…)`, on every new contact;
- `GET /fsm/v1/Work_Orders` and `GET /fsm/v1/Requests` by `Modified_Time`, on a retry only;
- `Zip_Code` on a new contact's service address.

A failed read is logged and the record made as before, so none of the reads can stop a booking. The field can: if FSM refuses it, a new client's first booking fails and is refunded. Staging proves all four on the first booking from the site with a new number (`docs/open-points.md`).

## Consequences

- A client who pays inside the countdown is booked, however late the webhook, unless FSM refuses for half an hour; then the client is refunded and ops know exactly what happened to the money and to FSM.
- An unpaid hold's time is free to others two minutes after its countdown, not at once.
- The app: a paid hold never reads `expired`; `DELETE /api/holds/{id}` leaves a paid hold alone; each day of `GET /api/availability` carries its own price.
- The site: `409 already_booked` carries `booked: { date, window }`; the landing's answers carry `invite`. `GET /api/r/{code}` still answers valid or unknown: whether an invite has expired is a fact about the friend who was held under it, known only once they give their number (ADR 0025, item 39).
- The same-mobile fraud rule can only match a number one of the two has changed to since: a number change does not keep the number it replaced, so a referrer's first number is not compared.
