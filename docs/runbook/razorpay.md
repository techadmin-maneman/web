# Razorpay

Part of the [runbook](../runbook.md), whose opening says how its commands are written.

Razorpay is the record of money. We learn of each payment and refund from its webhook (ADR 0044). Where the webhook misses a payment, the cron's `razorpay_catch_up` job reads it from Razorpay (below). Production has payments switched off today (`PAYMENTS_PROVIDER` is `none`).

## Razorpay's webhook is not arriving

Symptoms: the alert "Payment … reached us only when we asked Razorpay" (key `razorpay_payment_unheard:<payment ID>`), or `razorpay_payment_unheard` in Workers Logs. Clients who pay wait longer than they should for their booking to confirm.

The cron's `razorpay_catch_up` job, every quarter hour, asks Razorpay about each payment the webhook may have missed:

- a hold paid at Checkout and never confirmed, from a quarter hour after its grace ended until three days after it ran out;
- a hold ops sent a payment link for, from an hour after it was made until three days after it ran out;
- a one visit's payment link, from an hour after it was sent until a week after it was made.

Each is asked about at most once an hour; holds and links take turns while the run's calls last, so a long list waits a few runs. A payment found is recorded as the webhook would have recorded it, and its hold is booked, or refunded in full if Razorpay made the payment after the hold and its grace ran out (ADR 0068). Ops get one alert per payment. Close it once the cause below is put right. "Booking … is paid for, but could not be booked or refunded" (key `razorpay_catch_up_not_booked:<hold ID>`) is a found payment that needs ops: book the visit for the client from the console, or refund the payment once in Razorpay's dashboard.

To see how far the webhook is behind:

```sql
SELECT event, COUNT(*) AS events, MAX(received_at) AS last FROM razorpay_events GROUP BY event;
SELECT id, person_id, razorpay_order_id, payment_checked_at FROM slot_holds
WHERE razorpay_order_id IS NOT NULL AND confirmed_at IS NULL AND created_at > '<since, ISO>' ORDER BY created_at;
```

The second lists the holds whose Checkout opened and whose payment we have not heard of, and when the cron last asked Razorpay about each.

The cause, from Workers Logs:

- the route answers 404: `RAZORPAY_WEBHOOK_SECRET` is not set on the Worker (step 11c, point 2);
- `razorpay_hook_unauthorized`: the secret in Razorpay's webhook is not the Worker's;
- nothing at all: Razorpay is not calling. The webhook is disabled (Razorpay disables one that has failed for 24 hours, and e-mails the account), its URL is wrong, it is set up in the other mode from the keys (test or live), or, on staging, Access is stopping `/api/hooks/` (step 12, point 3);
- `razorpay_hook_refund_early`, answered 409: a refund came before its payment, in an event that does not carry the payment. Razorpay sends it again; nothing is wrong.

Put the cause right, and re-enable the webhook in Razorpay's dashboard if it was disabled. Razorpay retries a delivery that failed for 24 hours. A capture that arrives late is judged by Razorpay's own time: paid within the hold's ten minutes and its two minutes' grace, the visit is booked; if the time has gone to another client meanwhile, the payment is refunded in full (ADR 0068). A payment the cron recorded first is not recorded again when its webhook arrives.

A payment older than the cron looks (a hold three days past, a one visit's link a week old) is not found by it: look it up in Razorpay's dashboard, and refund it there, then ask the client to book again. That refund's own event carries the payment, so both are recorded then, nothing is booked for it, and ops get one alert per payment ("Payment … was refunded in Razorpay before we heard it was paid", key `razorpay_refund_unheard:<payment ID>`). Close it once the client has been told. The same alert for a refund no one here made means the webhook is missing payments: work through this section.

## A payment link

A consultation and fit in one visit is paid by the link its close makes (ADR 0105), and a paid visit ops book in the console by the link the booking makes. Razorpay texts the link to the client, with reminders. On staging it texts only a number on `MESSAGING_ALLOWLIST`: for any other number the link is made but not texted, the Worker logs `payment_link_not_texted`, and the link is on the client's Payments tab to send by hand.

A one visit's link takes payment for 14 days from when Razorpay made it; a console booking's closes with its hold. A one visit's link that closed unpaid stays on Tasks as "link closed unpaid", and reads "Closed unpaid" on the client's Payments tab.

The Worker cancels a link at Razorpay when the client is erased, and when the visit is paid by another link, such as one you made by hand. One Razorpay will not cancel raises an alert with the link's ID (`erased_link:<link>` or `paid_elsewhere_link:<link>`).

By hand, in Razorpay's dashboard, under Payment Links:

- **A new link** for a one visit whose link closed unpaid or was never made: create a payment link for the amount on the Tasks line, with the visit's ID as its reference. Its payment finds the visit.
- **Cancel a link** that should no longer take payment, for a wrong price or a visit settled another way: find it by its reference (`MM-…`) and cancel it. For a one visit, then send the right one as above.
- **Paid twice:** if the client paid two links for one visit, refund one of the payments.

## A refund that failed

"The refund of Rs. _n_ for visit _id_ … failed" (`cancel_refund_failed` for a cancel, the client's or ops', `no_show_refund_failed` for a waived no-show). Nothing tries it again. In Razorpay's dashboard, find the payment the alert names, check it shows no refund of that amount, refund it once, and close the alert. The refund's webhook records it, and the client's Payments tab shows it.

"Booking _id_ owes back payment _id_ …" (`hold_refund_failed`): a payment made too late, or for a hold already let go, that Razorpay would not refund. "Razorpay failed refund _id_ …" (`refund_failed`): a refund Razorpay accepted and then failed; the client's app says their refund is being redone. Neither is tried again by itself, and the Tasks board lists each under "Payment to refund" until a refund of the payment goes through. Refund it once from Razorpay's dashboard; where the alert says Razorpay did not answer, check first that no refund of it shows.

A payment partly refunded in Razorpay's dashboard, whose hold is then given back, has the rest refunded with it.

A cancel (the client's or ops') whose refund was never asked for, or never recorded (D1 lost, or the Worker stopped, once the visit was cancelled), is no alert: the cron's `cancel_refunds` job asks for it again at its first quarter-hourly run from ten minutes on, under the cancel's receipt. If Razorpay refuses that, the alert is the "may have been made" one, since the first ask may have refunded it: refund by hand only if the payment shows no refund of that amount.

---
