# 0100. A refund is made once, however often it is asked for

- Status: accepted
- Date: 2026-10-01
- Amends [0045](0045-self-serve-booking.md), [0095](0095-a-booking-fsm-refuses-is-held.md) and [0096](0096-a-no-shows-charge-and-its-dispute.md), whose refunds took any failure as Razorpay's refusal (`docs/open-points.md`, item 161)

## Context

Three things refund a client: ops' refund of a booking FSM refused, and any other hold let go with its payment (`refundOnce`, `src/domain/booking/give-back.ts`); a cancellation (`src/domain/visits/visit-changes.ts`); and a no-show's ruling (`src/domain/no-shows/after-a-ruling.ts`). Each took any failure of `payments.refund` as a refusal, a 10-second timeout included. But a timed-out refund may have been made, with only its answer lost:

- the held booking cleared its claim and waited, and the console told ops to try again **or refund it in Razorpay's dashboard**;
- the cancellation and the ruling told ops to "refund it by hand in Razorpay, once".

Either way, a refund Razorpay had made could be made twice.

Razorpay's refunds take a `receipt`, which "serves as an idempotency key": a second refund of the same payment under the same receipt is refused, "Duplicate receipt found for this refund request." (https://razorpay.com/docs/api/refunds/create-normal/, "Duplicate Receipt").

## Decision

**Every refund carries a receipt of its own** (`refundReceipt`, `src/domain/money/refunds.ts`). There is one per hold (`h-<hold>`), one per cancellation (`c-<visit>`), and one per no-show ruling on a visit (`nw-`, `nc-` or `nd-<visit>`, for waived, charged and refunded on dispute). Each is within Razorpay's 40 characters. So a refund can be asked for again without being made twice.

**Razorpay's silence is not its refusal.** The client (`src/providers/payments/razorpay.ts`) throws `PaymentUnanswered` where it cannot say whether a refund was made:

- a timeout or a network failure;
- a failure of Razorpay's own (5xx);
- a success it cannot read.

It answers a duplicate receipt as a refund made before, with no ID. Only a refusal Razorpay gave in words (4xx) is a refusal.

**A refund with no answer is asked for again at once, under its receipt** (`askRefund`). It is then made now, or found made before. Asked twice with still no answer, it is `unanswered`. A refusal after a first silence is also `unanswered`, since Razorpay may refuse a payment already refunded before it reads the receipt.

**What each path does with an unanswered refund:**

- **The held booking** keeps waiting, its claim let go, and ops' answer is `refund_unanswered`. The console says the refund may have been made, and to press Refund it again, never to use the dashboard.
- **A cancellation and a no-show ruling** tell ops once to look at the payment in Razorpay, and to refund it by hand only if no refund of the amount is there. Their alert for a refusal is unchanged.

## Consequences

- The common case, a refund made whose answer was lost, is found at once and never reaches ops.
- A cancellation's refund ID is kept only when Razorpay gave one; a refund found made before has none, and Razorpay's webhook still records it (ADR 0044).
- A refund ops make by hand in Razorpay's dashboard carries no receipt of ours, so the console's advice for a refusal is unchanged: refund it there, then press Refund it, which finds the payment refunded.
- Tests: `test/node/api/refunds.test.ts`; additions to `razorpay-client`, `held-bookings`, `visit-changes` and `no-show-disputes`; the console's held-bookings spec.
