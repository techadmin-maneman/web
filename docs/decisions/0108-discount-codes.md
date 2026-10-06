# 0108. Discount codes

- Status: accepted, on the owner's rulings of 1 October 2026 (ADR 0025, item 100)
- Date: 2026-10-01

## Built

The owner asked "to allow for discount codes to be generated and used before invoicing", and ruled: % or rupees, per code; ops choose what each covers; the client, the technician or ops enter it; ops set its limits. The rules are `src/policy/discount-codes.ts`.

- **Codes and uses** (migration 0063): a code is a percentage with an optional cap, or an amount, before GST; the kinds of visit it covers; a last day, total uses, once per client; switched off at any time. Each entry on a booking is a use, never deleted; one taken off is marked removed. A use on a hold let go or lapsed unpaid, or on a visit cancelled, no longer counts. One statement writes a use while the code still has one left, so two entries cannot take its last.
- **Where it is entered, always before the invoice:** the app's pay step, before Checkout has its order (`/api/holds/{id}/discount-code`); `/book` with the one visit (`discount_code` on `POST /api/consultation`; kept on the request while booking is off, for ops); the technician on a one visit before its payment link (`POST /api/tech/jobs/{id}/discount-code`, asked at once, no amount answered); ops on a visit not yet paid for, linked or invoiced (`/api/visits/{id}/discount-code`). Settings · Discount codes makes one or a batch of single-use codes after a check, lists them with their uses, and switches one off; ops' changes are audited with IDs and codes only.
- **Credits first:** a client holding referral credits spends them first; a code is refused, as not applying, on any visit a credit could pay.
- **Money:** the Checkout order, the payment link and the payment carry the discounted price, so a refund refunds what was paid. Checkout's order is kept only while the hold's price is the one it was made for, else made again; a code may change after Checkout was closed unpaid, once Razorpay holds no payment on the order but failed ones, and the order is then let go. A link is written only while the visit's code is the one read. The invoice pass writes the code onto FSM's draft in Books as the visit line's discount, before tax, checks the total against what was sold, and only then sends it; if Books refuses, the draft is held and ops told.
- **Free:** a code that leaves nothing to pay books the app's visit without Checkout, and settles a one visit at its close with no link, task or alert; the client gets WhatsApp's word either way (`visit_booked_code_v1`, `visit_fitted_code_v1`).
- **Abuse:** a wrong code is told only that it does not apply; every check counts, ten a day per client or technician and thirty an hour per address.

## Settled by the owner, 1 October 2026

- A move: "The code moves with it". The visit a late move books keeps the code and its discount, counted once.
- Switched off or expired after it was entered: "Keeps it". A code typed on `/book` while booking is off is honoured as it stood when typed (owner, 2 October 2026): ops booking the one visit from the request, or entering that code on it later, judge switch-off and last day as at the request, and its uses as they stand, since typing it kept none (`src/domain/money/requested-codes.ts`).
- After payment: "No, only before payment"; money goes back by the existing refund path.
- The invite's page: "No code on the invite page".
- A cancelled booking: "The use comes back", whatever was paid or refunded.
- An invited friend: "Yes, codes are for anyone". The owner retired the referral rule "There is no other discount for the referred person"; credits still pay first.
- A free visit: "send whatsapp message even when the code makes the visit free".
- An invited friend's one visit made free: "Yes, once fitted". With nothing owed, the fit settles the referral on the next pass (`appointments.nothing_owed_at`), where it otherwise waits for the link's payment (ADR 0025, item 93).

## Still the owner's

- Every word of the boxes, the refusals and the two WhatsApp templates is a placeholder; the templates need Meta's approval before production.
- Codes ops type use only letters and digits that cannot be misread (no I, L, O, 0, 1): a default.

## Production depends on

Books set to give discounts at line-item level, before tax, and one discounted visit invoiced on staging: the line-discount call has not been tried on the org (`docs/open-points.md`, item 181; runbook 11b, point 9).
