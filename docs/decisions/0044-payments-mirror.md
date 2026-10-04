# 0044. The payments mirror

- Status: accepted. Amended by ADR 0068: a refusal from Books is told to ops, once, as well as logged. Amended by ADR 0068: a capture confirms its hold, and a payment keeps its GST. Amended 2 October 2026: payment links number from the same series, and a link's payment takes the reference its link was made under. Amended 4 October 2026 by [0110](0110-field-work-without-fsm.md): a payment is applied to the Books invoice we make, not to one of FSM's.
- Date: 2026-09-22

## Context

P2-M2 includes "the payments mirror from Razorpay webhooks". The client app's Payments tab (boards E1 to E3) lists what a client paid and what was refunded. The fraud rules of P2-M3 compare how a referrer and a friend paid.

Razorpay is the record of money (`docs/phase2-inputs.md`, section 4). The research found:

- Webhooks are signed: `X-Razorpay-Signature` is the HMAC-SHA256 of the raw body under the webhook secret.
- They are delivered at least once and not in order, and must be answered within five seconds.
- `X-Razorpay-Event-Id` identifies each event.
- No card fingerprint is given to a merchant (ADR 0025, item 21). The UPI handle is given.

Checkout, orders and refunds from our side arrive with self-serve booking (P2-M5).

## Decision

**`POST /api/hooks/razorpay`, on the public host with the other webhooks.**

- It checks the signature over the raw body before anything else. Without `RAZORPAY_WEBHOOK_SECRET` the route answers 404, as the other hooks do without their secret. The secret must be at least 32 characters, and self-serve booking does not start without it.
- Each event is kept once in `razorpay_events`, by its event ID. A repeat is acknowledged and changes nothing.

**`payments` and `refunds` follow the events** (migration 0014, `src/domain/payments.ts`).

- **A payment's state only moves forward:** failed, authorized, captured, partially refunded, refunded. An authorization arriving after its capture changes nothing. A late authorization does overtake a failure, as Razorpay's late authorisations can.
- **A refund's processed amount** sets the payment's refunded total and state.
  - A refund for a payment not yet recorded records the payment from the refund's event, which carries it, then the refund. The payment's hold is not confirmed, so nothing is booked for money that has gone back, and ops are told once. Only an event that does not carry its payment is answered 409 and not marked seen, so Razorpay's retry is applied once the payment has arrived.
- **A captured payment gets our reference,** "MM-2026-0841": the next number of its India year. It is given in one statement, so two captures at once cannot share a number.
- **The person** is the one named in our order's notes (from P2-M5), or else the one whose mobile number paid. The mirror never creates a person from a payment. The appointment is the one named in the notes.
- **A capture confirms the hold its order was for** (ADR 0068): the hold keeps its time from then until it is booked or refunded. Whether the payment was in time is judged on Razorpay's own time for it (`created_at`), not on `captured_at`, which is when its webhook reached us.
- **A payment keeps what it was sold at:** the figure before GST and the rate, from the hold whose order it paid (`amount_ex_gst`, `gst_percent`, migration 0039). The Payments tab shows those; a payment no hold priced is split at `GST_PERCENT`.
- **Only `payment.captured` queues a booking.** `order.paid` says the same of the same payment, and is recorded only.

**What is kept.** Amounts are kept in paise, with the method (UPI, card and so on) and the card network.

- **No card data** of any kind.
- **The UPI handle only as an HMAC** under `IP_HASH_SALT`. The fraud rules can compare it; no one can read it.

**Keys.** `PAYMENTS_PROVIDER` is `razorpay` on staging, with test keys, `stub` locally, and `none` in production until Phase 2's release.

- The key ID is a var: it is public, since Checkout uses it in the browser.
- The key secret and the webhook secret are secrets.
- The guard refuses a live key anywhere but production, and a test key in production.

## Consequences

- **Staging takes no real money.** Its keys are Razorpay's test keys.
- **The webhook is created in Razorpay's dashboard** (runbook, step 11c), since Razorpay offers merchants no API for it.
- **Live mode** waits for P2-M5: KYC, live keys and a live webhook (`docs/open-points.md`, item 6).

## Receipts in Books (P2-M2, 22 September 2026)

A client who pays in advance is owed a receipt, then the tax invoice with the payment set against it, and a refund voucher if money goes back (plan input 11). The owner chose Books for these, and to record staging's test payments there (22 September 2026). FSM's invoices already reach Books, which is linked to FSM and syncs both ways every two to three hours.

**Each captured payment is recorded in Books** as a customer payment (`src/domain/books-sync.ts`).

**Not a retainer invoice.** The backend prompt has FSM carry "the retainer invoice as the prepay record, as the roadmap sets out". FSM raises no retainer invoice, which is a Books document; whether one may carry GST was unclear; and Books offers it only from its Professional plan (`docs/phase2-inputs.md`, section 6). A customer payment records the same money, gives the client a receipt, and settles against the visit's invoice once that is issued (ADR 0056), so the backend records that instead. (Recorded 27 September 2026, ADR 0025, item 56; the CA confirms the receipt serves once GST is on, `docs/open-points.md`, item 9.)

- It goes against the client's Books customer: the FSM contact's `ZBilling_Id`, which FSM's sync fills in. Until the client reaches Books, the payment waits.
- The mode is "Razorpay"; the reference is ours (MM-2026-0841). On staging the description begins "Staging test:" (`docs/open-points.md`, item 19).
- **Books' own receipt is the receipt.** `GET /api/payments/{id}/receipt` streams its PDF; `documents.receipt` gives the payment's ID once Books has it.

**Applied to the visit's invoice** once Books has sent it, up to what the invoice still owes. A draft waits. A paid or void invoice, or an application Books refuses, is logged for ops and not tried again.

**A processed refund is recorded against its payment,** from `BOOKS_REFUND_ACCOUNT_ID`, the bank account Razorpay settles into. Books refuses a refund from Undeposited Funds, and our token cannot create accounts, so the owner creates it (runbook 11b, step 7). While the var is empty, refunds are not recorded (`docs/open-points.md`, item 10). The refund voucher stays null in the API: Books' refund has no PDF of its own that we have found.

**On the five-minute cron,** after the FSM reconciliation, never in the payment's path, so Books is never on the way to a booking.

- Each pass takes up to five of each, oldest first.
- A record found not ready (no Books customer, a draft invoice) or refused waits an hour before Books is asked again, which keeps us well inside Books' daily API allowance.
- Any other failure is logged, and the next pass tries again.

### Consequences

- A first payment's receipt can take up to three hours: FSM's sync must first put the client into Books.
- Staging's test payments are in the real Books org, labelled, until they are removed before go-live (`docs/open-points.md`, item 19).
- With GST at 0% on staging, a receipt carries no tax. When GST goes on, the CA says whether an advance needs tax on its receipt; Books can take it on the customer payment (`docs/open-points.md`, item 9).
