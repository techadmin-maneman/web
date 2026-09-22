# 0045. Self-serve booking and prepayment

- Status: accepted; in progress
- Date: 2026-09-22

## Context

The prompt's P2-M5: "availability, holds, Razorpay checkout, credit redemption, reschedule and cancel under the 24-hour policy, refunds, and late fees", behind `SELF_SERVE_BOOKING`. Every visit is prepaid at booking. On 22 September 2026 the owner asked for it now, on staging, so the whole path from a booked lead to an invoiced visit can be tried end to end, ahead of dispatch (P2-M4).

## Decision

**Behind `SELF_SERVE_BOOKING`,** a var: on locally and on staging, off in production until the owner switches it on. Off, every booking route answers `409 ops_assisted`, and the app opens WhatsApp to ops (ADR 0043). The guard refuses it on without a payments provider.

**The price book is a table** (migration 0016): item, tier, ex-GST amount in paise, GST rate, and the date it applies from. It is the only source of prices. It opens with the design's figures at the owner's placeholder 5% (`docs/open-points.md`, items 1 and 2).

**Who may book what** (`bookableTypes`): a consultation first; a first fit once a consultation is done; then service visits and replacements.

**Availability** (`GET /api/availability?type=&from=`): 14 days from tomorrow, three windows each, and for each window whether the client's regular technician (whoever did their latest visit) could come, another could, or nobody (full). It uses the clash check (ADR 0034) and the window-to-slot map (ADR 0035).

**A hold** (`POST /api/holds`) takes the window for ten minutes: the regular technician if free, else whoever has least that day. It carries the price at that moment, the late fee a first fit or replacement would cost to move inside 24 hours, and when moving stops being free (24 hours before the window opens). A client has one hold at a time; a new one lets the old go.

**Payment and the write to FSM** arrive in the next change: a Razorpay order for the hold, Checkout in the app, and, once Razorpay's webhook confirms the capture, the visit written to FSM, with a refund if FSM refuses it or the hold had lapsed.

## Consequences

- Booking runs on staging before dispatch exists: every active technician is free every day, and ops still see and change everything in FSM.
- Credits (P2-M3) are not yet redeemed: the credit-applied board (C5) waits for the ledger.
