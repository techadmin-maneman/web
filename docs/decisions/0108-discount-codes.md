# 0108. Discount codes

- Status: accepted, on the owner's rulings of 1 October 2026 (ADR 0025, item 100); what they left open is taken for the owner to confirm (item 101)
- Date: 2026-10-01
- Amends [0045](0045-self-serve-booking.md) and [0068](0068-a-paid-hold-is-kept.md), whose hold kept the price it was made at until it was paid for: a code entered before Checkout has its order prices it again; [0105](0105-a-consultation-and-fit-in-one-visit.md), whose payment link was for the product's price: it is for the price less the visit's code, and a code on a one visit the client declines is given back; and [0056](0056-issuing-the-invoice.md), whose invoice pass issued the draft FSM raised as it came: a code's discount is written onto the draft first. Follows [0071](0071-what-ops-see-before-a-setting-changes.md) for what ops see before a change

## Context

The owner asked on 1 October 2026 "to allow for discount codes to be generated and used before invoicing", and answered each question in turn:

- **What a code takes off:** "% or rupees, per code". Ops choose a percentage, with an optional rupee cap, or a fixed rupee amount when generating a code. The discount comes off before GST, so the invoice shows the discounted price.
- **What it covers:** "Ops choose per code": the first fit (the one-visit consultation and fit included), service visits, replacements, or any of them.
- **Who enters it:** "Client, technician or ops": the client where they pay or book (the app's pay step; the site's booking form for the one visit); the technician before sending the pay-at-visit link; ops on a booking in the console. Always before the invoice is made.
- **Usage rules:** "Ops set limits per code": an expiry date, total uses (one, many or unlimited), once per client; one code per booking; never on a visit a referral credit pays for; ops can switch a code off at any time, and its uses stay on record.

The rules are `src/policy/discount-codes.ts`, each tested in its own words (`test/node/policy-discount-codes.test.ts`).

## Decision

### Codes and their uses

**Migration 0064** adds two tables (`docs/schema.md`):

- **`discount_codes`**: the code's text, kept in capitals and unique; `kind`, `percent` or `amount`, and `value`, per cent or paise; a percentage's `cap` in paise; one flag for each kind of visit it covers; `expires_on`, the last day in India it may be entered; `max_uses`, null for no limit; `once_per_client`; the `batch_id` of codes generated together; who made it and when; and who switched it off and when.
- **`discount_code_uses`**: each time a code is entered on a booking, its hold or its visit, by whom (`client`, `technician` or `ops`, with their ID or Access identity), and `amount_off`, the paise it took off before GST once the price is known. A use is never deleted, and what it says is written once (two triggers): only its amount, while it has none, and its removal, once, are added later. A code taken off a booking is `removed_at`, by whom. One code per booking is two partial unique indexes, a hold's and a visit's, over the uses not removed.

**A use stands** while it is not removed and its booking holds: one on a hold that was let go, or that stopped keeping its time with nothing paid, no longer stands. That is read, not written: a hold lapses by the clock, with no write to hang a release on. Only a use that stands counts against its code's limits, so a client who lets a hold go unpaid has the code again, as does the next client of a single-use code. **The use is written by one statement** that reads the code's switch, its limits, the client's own uses and the booking's other codes as it writes, so two entries at once cannot both take a code's last use.

**The code's text** is of the letters and digits none reads as another, with no I, L, O, 0 or 1 (`CODE_ALPHABET`). Generated codes are eight of them, about 850 billion; a code ops type is four to sixteen, held to the same characters, and matched whatever its case.

### What a code takes off

**Before GST, never below nought** (`amountOff`, `discounted`): a percentage of the price before GST, rounded to the paisa and held to its cap; or the amount, no more than the price. GST is then charged on what is left. A code worth the whole price makes the booking cost nothing.

**What a use takes off is fixed once the price is known**: as it is entered, on a hold or on a visit whose service the book prices that day; at the payment link, for a one visit, whose product the client chooses at the visit. From there the hold, the Checkout order, the link, the payment and the invoice carry the discounted figure, and a refund refunds what was paid, never more.

### Where it is entered, always before the invoice

| Who        | Where                                                      | Route                                            | Until                                                   |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| The client | The app's pay step: "Have a discount code?"                | `POST`/`DELETE /api/holds/{id}/discount-code`    | Checkout has its order                                  |
| The client | `/book`, with the consultation and fit in one visit        | `discount_code` on `POST /api/consultation`      | the booking                                             |
| Technician | The outcome step of a one visit, before closing it as done | `POST /api/tech/jobs/{id}/discount-code`         | the payment link is made                                |
| Ops        | A client's Visits tab, a visit at a time                   | `POST /api/visits/{id}/discount-code`, `/remove` | the visit is paid for, its link made, or it is invoiced |

- **The app's pay step** prices the hold again with the code taken off, and shows the price before it struck through and the code's line beneath. The client may take it off again. Both stop once the client taps pay: the order Razorpay holds is for one figure, so its hold's price no longer changes (`price_settled`).
- **`/book`'s one visit** checks the code as it books, and a code that does not apply refuses the booking, `422 code_not_applicable`, naming the box, so the client can put it right or leave it out. The use stands on the hold with no amount yet, and comes off the product's price at the link. While self-serve booking is off, the code is kept on the request (`consultation_requests.discount_code`), and the Tasks board names it beside the one visit, for ops to enter on the visit they book by hand. The invite's page takes no code (item 101).
- **The technician** asks the API at once, not through the outbox: he must hear whether it applies while the client is there. The answer carries the code, never an amount. A one visit the client declines gives its code back (`removed_by` `system`): nothing was sold.
- **Ops** enter a code on any visit of a covered kind whose price is still open, or take it off; the client's page shows each visit's code, what it took off and who entered it. Each is audited in its batch.

**A code that does not apply is told only that** (`422 code_not_applicable`), whatever the reason; the reason is logged (`discount_code_refused`), never shown. **Every check is counted** (`src/http/code-checks.ts`): ten a day for a client or a technician, thirty an hour from one address, right or wrong, so a code cannot be found by guessing. The site's form needs no counter of its own: its Turnstile check and daily limits already hold each number to five bookings a day and each address to twenty.

### The invoice shows the price, the discount and the total

FSM raises a visit's invoice in Books as a draft at its catalogue price, and the invoice pass issues it only once it totals what the client was sold the visit for (ADR 0070). **With a code on the visit, the pass writes the discount onto the draft first, as Books' own line discount, before tax** (`discountInvoice`, `src/providers/books.ts`): it reads the draft, sends every line back, the visit's line, the dearest, carrying the discount in rupees, with `discount_type` `item_level` and `is_discount_before_tax`, and checks the total Books then gives. A visit paid for is sold for what was paid; one not paid for, for its price less the code. **If Books will not take the discount, the draft is held**, and ops are told once what to set on the visit's line before they send it there.

We use the line discount because the brief asks for it where the integration supports it, and Books does: the invoice shows the visit's price, its discount and the total on the visit's own line. The invoice-level discount Books also offers would read the same on a one-line invoice; it would not on a visit that bills parts, which the line discount leaves alone.

### Settings · Discount codes

A tab of its own in Settings (`apps/ops/src/settings/DiscountCodes.tsx`): **make** one code typed or generated, or a batch of up to a hundred single-use codes, with its kind, value, cap, the kinds it covers, its last day, its total uses and whether it is once per client; **the check** lists what will be made before anything is sent, and only the second press makes it (ADR 0071); **the list** shows the latest two hundred codes, each with what it takes off, its limits, how many bookings it stands on and what it has given, and finds one by its text however old; **switch off** says how many bookings keep the code and needs a second press. Each change is audited with IDs and codes only: `discount_code.make`, `discount_code.switch_off`, `discount_code.apply` and `discount_code.remove`.

## What the rulings left open, taken for the owner to confirm (ADR 0025, item 101)

- **A move takes no code.** A code is for a visit sold: neither a move's late fee nor the visit a late move books in its place takes one.
- **A code on a booking stays.** Switched off, or past its last day, after it was entered, a code still comes off the booking it is on, as a hold keeps the price it was sold at (ADR 0068). Switching off stops new entries.
- **Ops enter no code on a visit already paid for.** Taking a code off a paid visit would leave the client owing; entering one would mean a part refund the owner has not ruled. Ops refund through the existing path instead.
- **The invite's page takes no code.** The invite is that page's offer; an invited friend may still give a code at the app's pay step or to the technician, since the rulings exclude only a visit a credit pays for. The referral rule "There is no other discount for the referred person" is about what the referral earns, and a code is not part of it.
- **A booking cancelled keeps its use**, and ops may take it off in the console, which gives the code back, until the visit is paid for or invoiced.
- **Typed codes keep to the unambiguous characters**, so a word such as WELCOME, with its L and O, cannot be a code.

## Consequences

- **Migration 0064** only adds: two tables, their indexes and triggers, and `consultation_requests.discount_code`, empty on every row. The Worker already deployed reads none of them.
- **The contract**: `discount` on the client's `Hold`; `discount_code` on `POST /api/consultation`, in and out; the technician's `POST /api/tech/jobs/{id}/discount-code`; the console's `/api/discount-codes` and `/api/visits/{id}/discount-code`, and `discount_code` and `price_open` on each `ClientVisit`; the error codes `code_not_applicable` (422), `already_discounted` (409), `price_settled` (409) and `code_exists` (409). Regenerated documents and types.
- **A booking a code makes free** is booked as a free visit, with no Checkout, and so sends no receipt on WhatsApp: no template says "booked, nothing to pay" (open point 182).
- **The words** of every box and refusal are placeholders, in the apps' content files and the site's (open point 180).
- Tests: `test/node/policy-discount-codes.test.ts`; `test/worker/discount-codes.test.ts` (Settings, a code on a visit in the console, the invoice); `test/worker/discount-code-entries.test.ts` (the pay step, the site's form, the technician); the Books call in `test/worker/fsm.test.ts`; `test/worker/audit-with-action.test.ts`; the browser specs of the pay step, `/book`, the technician's outcome step and the console.

## Not tried on the org

`PUT /books/v3/invoices/{id}` with `discount_type`, `is_discount_before_tax` and a line's `discount` follows Books' API documentation and has not been tried on the owner's org; Books must also be set to give discounts at line-item level (Settings, Preferences, Invoices). Until the first discounted visit is invoiced on staging, the pass's own check holds any draft whose total Books gives back is not the discounted figure, and tells ops (open point 181).
