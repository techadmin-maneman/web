# 0057. One payment per tap

- Status: accepted
- Date: 2026-09-23

## Context

Board C6 is the screen a client reaches **after a payment has already failed once**, and it offers two buttons: Try again, and Another method. Both called `payFor`, which awaits `POST /api/bookings` before anything on the screen changes. Neither button was disabled while it waited.

So a client who taps twice inside that round trip — which is what an anxious person does on the screen that has just told them their payment failed — started two payments for one hold. Reproduced in the browser (`e2e/app/booking.e2e.ts`): the two taps made **two `POST /api/bookings`** against one hold, with both buttons live throughout.

**What the second request did on the server was worse than a second request.** `startBooking` already meant to make one order per hold, and read `slot_holds.razorpay_order_id` to decide. Two requests that arrive together both read it as null, both call Razorpay, and both write — so the hold ends up naming one order and the other is orphaned. Reproduced at true concurrency in `test/worker/booking/bookings.test.ts`:

| Two `POST /api/bookings` for one hold, at the same moment                | Before                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Razorpay orders made                                                     | **2**                                                         |
| Distinct orders handed to the client                                     | **2**                                                         |
| `confirmBooking`, when the client paid on the one the hold does not name | `not_paid` — **no visit**                                     |
| Visits written to FSM                                                    | 0                                                             |
| What the app's poll sees                                                 | `state: held`, `paid: false` — it waits, then says it is slow |
| Refunds when the hold was then let go                                    | **0**                                                         |

Everything downstream keys off the hold's single `razorpay_order_id` column: `capturedFor` looks the payment up by it, and so does `giveBack`. A capture on the other order is therefore **neither booked nor refunded**, and nothing in the system knows the money arrived. That is the worst outcome this application has — the client is charged, gets no visit, and is not given the money back — and it needs only one order to be paid on, not two.

**What was seen, and where.** The two taps making two requests is the browser's, and it is certain. The two orders are the worker suite's, where the two requests are begun in the same turn and so are truly simultaneous. What was **not** seen is the two joining up in one run: the window the race needs is the time `payments.createOrder` is in flight, and against the local stub that is microseconds, so the browser's two taps — as far apart as a thumb makes them — reach `startBooking` one after the other and the second is caught by the read that was already there. In production that call is a live request to Razorpay's API, hundreds of milliseconds wide, and it is the second tap's landing ground. So the fix rests on a reproduced client defect and a reproduced server race, joined by that latency rather than by a single run that shows both at once.

## Decision

**Two layers, because they cover different things.**

**The sheet will not start a second payment.** `payFor` returns at once if a payment is already being started (`starting`, a ref, released in a `finally`), and `FailedStep` takes the sheet's `busy` and disables both buttons while it is true. The ref is what actually holds: `busy` is state, and only reaches the buttons on the next render, so a tap in that gap would otherwise get through. The disabled buttons are what the client sees, and the step carries `aria-busy` so a screen reader is told the step is working and holds its alert until there is something new to read.

**The hold settles which order is its own.** `startBooking` writes the new order with `WHERE razorpay_order_id IS NULL ... RETURNING`, and a request that does not win the write answers with the order the winner put there. It is the idiom `landJobEvent` already uses for the technician app's outbox: let the write decide, then answer with the row that won.

**`POST /api/bookings` takes no idempotency key**, and does not use `src/http/idempotency.ts`. The operation already has a natural, server-side key — the hold — and a hold is one client's and one visit's. `Idempotency-Key` on Phase 1's `POST /api/lead` (removed on 28 September 2026) and `X-Client-Event-Id` on the technician's writes were added because a lead and a job event have no such key; a booking does. Reserving the idempotency table on the hold id was tried on paper and rejected for two reasons: a key held for 24 hours would replay a stored `201` for a hold that has since been booked or has lapsed, where the route must answer `409 hold_expired`; and a worker that died between reserving the key and releasing it would leave a ten-minute hold that **nobody can ever pay for**. Trading a client who cannot pay for an inert order at Razorpay is the wrong way round.

## Consequences

- **A client cannot be charged twice for one hold.** Checkout only ever opens on an order the API handed back, and the API now hands back one order per hold however many times it is asked at once.
- **The server layer is the one that is actually true.** Proven by removing the sheet's guard and leaving the write: the two taps still made two requests, and the client was still given **one** order. The UI guard covers the common case and is the better experience; it is not what makes the money safe.
- **The race still makes an order that is thrown away.** The request that loses the write has already asked Razorpay for an order. That order is never in any response, so no Checkout can be opened on it, no payment can be made against it, and no webhook will ever mention it: nothing of ours records it and there is nothing to clean up. It sits in the Razorpay dashboard as an unpaid order in `created` and expires there. Making it not exist at all needs a lock taken before Razorpay is called, which is the failure mode above.
- **Nothing is reconciled by order.** `payments` rows are written by the webhook and keyed on the payment, and the passes read payments, not orders, so an order with no payment is invisible to the rest of the system by construction.
- **The hold's `razorpay_order_id` stays `UNIQUE`** (migration 0016) and is still written once. The change is only that the write, not the read before it, decides.
- The same shape — an await in a handler whose button stays live — is in seven other places in the client app. None of them can charge a client, and they are listed in the pull request rather than changed here.
