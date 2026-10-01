# 0045. Self-serve booking and prepayment

- Status: accepted; moving and cancelling in ADR 0046; a paid hold kept, and FSM written once, in ADR 0068; no hold without an address, in ADR 0079; amended 1 October 2026 by [0105](0105-a-consultation-and-fit-in-one-visit.md): a consultation and fit in one visit, booked from the site, is not prepaid but paid for at the visit, by a payment link once the client is fitted; amended 1 October 2026 by [0108](0108-discount-codes.md): a discount code entered at the pay step, before Checkout has its order, prices the hold again
- Date: 2026-09-22

## Context

The prompt's P2-M5: "availability, holds, Razorpay checkout, credit redemption, reschedule and cancel under the 24-hour policy, refunds, and late fees", behind `SELF_SERVE_BOOKING`. Every visit is prepaid at booking. On 22 September 2026 the owner asked for it now, on staging, so the whole path from a booked lead to an invoiced visit can be tried end to end, ahead of dispatch (P2-M4).

## Decision

**Behind `SELF_SERVE_BOOKING`,** a var: on locally and on staging, off in production until the owner switches it on. Off, every booking route answers `409 ops_assisted`, and the app opens WhatsApp to ops (ADR 0043). The guard refuses it on without a payments provider.

**The price book is a table** (migration 0016): item, tier, ex-GST amount in paise, GST rate, and the date it applies from. It is the only source of prices. It opens with the design's figures. GST began at the owner's placeholder 5% and is 0% on staging since migration 0018, so billing works end to end while the CA's rates are outstanding (ADR 0025 item 31; `docs/open-points.md`, items 1 and 2).

**Who may book what** (`bookableTypes`): a consultation first; a first fit once a consultation is done; then service visits and replacements.

**Availability** (`GET /api/availability?type=&from=`): 14 days from tomorrow, three windows each, and for each window whether the client's regular technician (whoever did their latest visit) could come, another could, or nobody (full). It uses the clash check (ADR 0034) and the window-to-slot map (ADR 0035).

**A hold** (`POST /api/holds`) takes the window for ten minutes: the regular technician if free, else whoever has least that day. It carries the price at that moment, the late fee a first fit or replacement would cost to move inside 24 hours, and when moving stops being free (24 hours before the window opens). A client has one hold at a time in the app; a new one lets the old go, unless it is paid for (ADR 0068).

**Paying** (`POST /api/bookings`, `src/domain/bookings.ts`): the hold's Razorpay order, made once, whose notes carry the hold and the person, and what Checkout opens with. A free visit, a consultation, skips payment and goes straight to the queue.

**Razorpay's webhook is the authority** (ADR 0044). On `payment.captured` whose notes name a hold, the hook confirms the hold and puts it on the fsm-sync queue. The consumer then:

- books the visit in FSM: the person's contact (added if they have none), a work order for the service, and its appointment with the hold's technician, from its half-slot for its length; each ID is kept as FSM gives it, so a retry makes nothing twice (ADR 0068);
- then, in one batch, the visit in the mirror, the hold booked, its claims let go, and the payment linked to the visit;
- refunds the payment in full instead, if Razorpay made it after the hold had lapsed and the two minutes' grace after it (ADR 0068). The refund is claimed on the hold first (`refunded_at`, migration 0017), so a repeated message cannot refund twice;
- retries a failure four times over seven minutes, then cancels what FSM holds for it, refunds the payment, and tells ops what happened to each (ADR 0068). A hold neither booked nor refunded half an hour on is put back on the queue by the cron.

The app polls `GET /api/holds/:id`, which says when the hold is paid and which visit it became.

## Consequences

- Booking runs on staging before dispatch exists: every active technician is free every day, and ops still see and change everything in FSM.
- Credits (P2-M3) are not yet redeemed: the credit-applied board (C5) waits for the ledger.
