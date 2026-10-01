# 0108. Discount codes

- Status: accepted, on the owner's rulings of 1 October 2026 (ADR 0025, item 100)
- Date: 2026-10-01

## Built

The owner asked "to allow for discount codes to be generated and used before invoicing", and ruled: % or rupees, per code; ops choose what each covers; the client, the technician or ops enter it; ops set its limits. The rules are `src/policy/discount-codes.ts`.

- **Codes and uses** (migration 0064): a code is a percentage with an optional cap, or an amount, before GST; the kinds of visit it covers; a last day, total uses, once per client; switched off at any time. Each entry on a booking is a use, never deleted; one taken off is marked removed. A use on a hold let go, or lapsed unpaid, no longer counts. One statement writes a use while the code still has one left, so two entries cannot take its last.
- **Where it is entered, always before the invoice:** the app's pay step, before Checkout has its order (`/api/holds/{id}/discount-code`); `/book` with the one visit (`discount_code` on `POST /api/consultation`; kept on the request while booking is off, for ops); the technician on a one visit before its payment link (`POST /api/tech/jobs/{id}/discount-code`, asked at once, no amount answered); ops on a visit not yet paid for, linked or invoiced (`/api/visits/{id}/discount-code`). Settings · Discount codes makes one or a batch of single-use codes after a check, lists them with their uses, and switches one off; ops' changes are audited with IDs and codes only.
- **Money:** the Checkout order, the payment link and the payment carry the discounted price, so a refund refunds what was paid. The invoice pass writes the code onto FSM's draft in Books as the visit line's discount, before tax, checks the total against what was sold, and only then sends it; if Books refuses, the draft is held and ops told.
- **Abuse:** a wrong code is told only that it does not apply; every check counts, ten a day per client or technician and thirty an hour per address.

## Defaults taken, for the owner to confirm

- A move takes no code: neither its late fee nor the visit a late move books.
- A code stays on a booking once entered, even if switched off or expired after.
- Ops enter no code on a visit already paid for; money goes back by the existing refund path.
- The invite's page takes no code (an invited friend may still give one in the app or to the technician).
- A cancelled booking keeps its use until ops take the code off; a one visit the client declines gives it back.
- Codes ops type use only letters and digits that cannot be misread (no I, L, O, 0, 1).
- A code that makes a visit free sends no WhatsApp receipt: there is no "booked, nothing to pay" template.
- Every word of the boxes and refusals is a placeholder.

## Production depends on

Books set to give discounts at line-item level, before tax, and one discounted visit invoiced on staging: the line-discount call has not been tried on the org (`docs/open-points.md`, item 181; runbook 11b, point 9).
