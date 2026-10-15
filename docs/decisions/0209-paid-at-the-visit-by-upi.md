# 0209. Paid at the visit by UPI, while online payment is off

- Status: accepted
- Date: 2026-10-15
- Topic: Money and Books
- Amends [0045](0045-self-serve-booking.md) on who books what with no payment provider

## Context

Production goes live on 18 October 2026 without Razorpay: live KYC will not clear in time. The business can take money by UPI into its own account, but not online through the apps.

Every paid visit was prepaid before it was booked: through Checkout in the app, or a payment link ops send from the console. With no payment provider, neither works, and the settings guard refuses self-serve booking.

## Decision

- **Consultations book themselves** (`SELF_SERVE_CONSULTATIONS`). A consultation costs nothing, so the site and the app book it outright with no payment provider. `/api/me` names the kinds a client books themselves, as `booking.self_serve_kinds`. For any other kind the app sends the client to ops on WhatsApp, and its routes answer `ops_assisted`.
- **Ops book paid visits, paid by UPI at the visit.** While no payment provider is on, a paid visit ops book in the console is booked at once. Nothing is taken, and the hold is marked `pay_at_visit` (migration 0181). The client's booking message names the amount to pay Mane Man by UPI at the visit (`visit_booked_at_visit_v1`). The technician never handles money.
- **Nothing to keep.** Nothing was paid at booking, so a late change or a no-show keeps nothing: the visit is sold with no late fee, and with no charge for either.
- **Ops record the payment.** Once the visit is done, it waits in Tasks as "UPI to record" until a payment is held for it, falling due 12 hours after it starts. Ops record it from the row under its UTR, once it is in the account (`POST /api/visits/{id}/upi-payment`). The payment is written as captured, with method `upi` and the next receipt reference, and the client is sent their receipt (`upi_received_v1`). A UTR is recorded once.
- **Never through Razorpay.** Such a payment's Razorpay ID is its UTR marked `upi:` (`src/policy/upi.ts`), and any refund of it is refused before Razorpay is asked. Ops refund it by UPI from the bank, as the refusal's alert says.

## Consequences

- A paid visit is booked with no money taken, so a client who does not pay costs a visit. Ops see each unpaid visit on Tasks the day it happens.
- Books, when on, records a UPI payment as it records any captured payment.
- When Razorpay is live, the payment provider comes back on, a paid visit ops book goes out as a payment link again, and `SELF_SERVE_BOOKING` turns every kind back to self-serve.
