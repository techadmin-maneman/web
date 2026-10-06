# 0105. A consultation and fit in one visit

- Status: accepted, on the owner's ruling D2 of 1 October 2026 and the rulings of the same day on the piece, the payment and the length (ADR 0025, item 89); what they left open is taken for the owner to confirm (items 90 to 92). Amended 2 October 2026: a link is made under the reference its payment will have ("MM-2026-0841"), which the client reads on Razorpay's page; a link ops make by hand still takes the visit's ID. Amended 4 October 2026 by [0110](0110-field-work-without-fsm.md): a one visit is booked in our own database; FSM makes no work order for it.
- Date: 2026-10-01
- Topic: Booking and visits
- Amends [0086](0086-the-next-visit-is-offered.md), whose site form asked for the first fit to follow the consultation; [0045](0045-self-serve-booking.md) and [0068](0068-a-paid-hold-is-kept.md), under which every visit is paid for before it is booked; [0096](0096-a-no-shows-charge-and-its-dispute.md), whose charge a booking that holds no payment is now sold to cost nothing; follows [0103](0103-the-home-pages-first-copy-round.md), whose "Still to build" named this piece

## Context

The site's form, on `/book` and on an invite's `/r/:code`, booked a free consultation and, as its second choice, asked for the first fit to follow: a request the app then offered, booked and prepaid once the consultation was done (ADR 0086). The home page has said since ADR 0103 that the fit can come "the same visit or a later one: your choice", which the form could not book.

The owner ruled on 1 October 2026 (D2): "Clients can choose one vs. two visits. If they choose consultation, the technician can measure and explain the product with the fit coming in later. If they choose consultation + fit, the technician can fit them their chosen product during the first visit itself". And, the same day: the piece is carried from stock, any of the four products (Mane Man Essential, Active, Natural and NatMax), chosen at the visit with the technician, never on the phone or the site; it is paid for at the visit, by a Razorpay payment link the technician sends once the client has agreed and been fitted, and nothing is paid if the client decides against it; and it is three hours, the first fit's block. Asked why it could not be in the evening, the owner asked for an evening visit that ends by 8 pm, which waits for a visit's minutes to be counted against the day's times (window times, part B).

## Decision

### A first fit, marked as one visit

**The one visit is a first fit marked as one, not a fifth kind of visit.** A kind is code, and a fifth would be a value every table that checks a kind refuses: `services`, `appointments`, the price book's items and every per-kind setting, several of which D1 could only take by rebuilding a table others reference. A first fit already has the piece step, the three hours, the evening's refusal, the FSM item and the fitted client that follow it; the mark adds only what differs. Migration 0061 adds it in three places:

- `slot_holds.one_visit`, 0 or 1: the hold the site's form made for it.
- `appointments.one_visit`, null for any other visit, else `booked` until the technician closes it, then `fitted` or `declined`. The booking writes `booked` from its hold, as it writes the hold's tier.
- `consultation_requests.one_visit`, for one asked for while self-serve booking is off.

A one visit still to happen is the client's consultation still to happen as well as their first fit (`liveVisitOf`, `src/domain/booking/availability.ts`), so neither form books a second consultation beside it, and the app offers none.

### The booking

**The form's second choice is "Consultation and fit, in one visit"** (placeholder words, open points 45, 162 and 165), in place of "The consultation, then my first fit" and its fit window, which are gone: `POST /api/consultation` and `POST /api/r/{code}/consultation` take `one_visit: true` where they took `first_fit`, and answer `one_visit` where they answered `first_fit`. The form writes no first-fit request; the table, its Tasks board group (First fit to book) and the data export's line stay for the requests written before.

**It books the first fit's own service on the day**, the standard one while it is offered (ADR 0085), for its length, three hours unless ops set another, **in the morning or the afternoon** (`ONE_VISIT_WINDOWS`, `src/policy/one-visit.ts`): the form offers no evening for it, and the route refuses one, `400 invalid_request` naming `window`. FSM books it on that service's item for those three hours, as any first fit; its summary names the service.

**Nothing is paid**: the hold's amount is nought, at the service's rate of GST, so it is booked at once, as the site's free consultation is, and the client is told on WhatsApp that it is booked and that they pay only once fitted (`one_visit_booked_v1`, placeholder; item 39). The consent recorded is the consultation's own, `referral-consultation-v1`, unchanged; whether it covers the fit is counsel's (open point 41).

**While self-serve booking is off**, it is a consultation request marked as one visit, which the Tasks board writes "+ consultation and fit in one visit", and which leaves the board once ops have booked the client's first fit or consultation in FSM: migration 0061's triggers mark the request booked as a first fit of the client's is written, as migration 0056's do for a consultation. Ops book it in FSM by hand, as a first fit for three hours, for the client's own contact. **The mirror marks it as one visit** when it first sees a first fit for a client whose one-visit request still waits, and from there it is any one visit: the products on the technician's card, the link at the close, Payment owed, and `ONE_VISIT_TERMS` for a move or a no-show, which a visit no hold sold reads from its mark (`termsOfVisit`, `src/domain/visits/visit-changes.ts`). A visit a hold booked is a one visit exactly when its hold was, whatever the mirror took it for. **What still needs ops by hand** (open point 167): a one visit booked in FSM after the request left the board, or for another number, is not marked, and ops send its link from Razorpay's dashboard with the visit's ID as its reference, which the webhook then finds the visit by; and in production, until the technician app is released, every link is sent so.

### A booking that holds no payment

**It is sold to cost nothing if missed or moved** (ADR 0025, item 90, for the owner to confirm): its hold keeps `ONE_VISIT_TERMS`, a late change and a no-show each costing `nothing`, as every booking keeps the terms it was sold under (ADR 0088). So a move inside the notice is free, a cancel gives back all of nothing, and a no-show ops charge takes nothing and leaves nothing to dispute. It is the same rule ADR 0096 applies to every booking, read from what this one was sold under.

### At the visit

**The technician's card** names the visit "Consultation and fit", with a badge of its own, "Pays once fitted" (`at_visit`, which the dispatch board shows too), and carries the products the client may choose: the first fit's services offered on the visit's day, by name and never by price. Its steps are the first fit's, the piece step first after the before photographs, so the client's choice is recorded before the checklist; its checklist is the consultation's and then the fit's, as ops set each, or the consultation's alone once the client declines (`checklistOf`, `declinedChecklistOf`, `src/domain/field/job-sheet-settings.ts`; the card's `checklist_if_declined` and `client_choice`). Ops keep the four products as first-fit services, one each, with their prices, in Settings · Services; until they add them the card offers the standard first fit alone (open point 168).

**The piece step records the client's choice** (`POST /api/tech/jobs/{id}/piece`): the product they chose, by its tier, with the piece fitted from the technician's kit, its label, base and lot, as any first fit's piece; or `declined: true`, when nothing is fitted and no label is asked for. A product not offered that day, a fit with no product, a piece that failed or one that came off are refused on a one visit; a product or a decision against the fit on any other visit. No new kind of step is added: `job_events` checks its kinds, and D1 could take a new one only by rebuilding a table others reference.

**Closing it as done** (`POST /api/tech/jobs/{id}/outcome`) reads the piece step:

- **Fitted**: the visit becomes the product's (`appointments.tier`), `one_visit` becomes `fitted`, and the client's payment link is asked for (below).
- **Declined**: the visit becomes a consultation (ADR 0025, item 92): its kind is `consultation` and `one_visit` `declined`, so the client is not fitted, no referral credits land, and the app offers the first fit as after any consultation. It is not invoiced. FSM keeps the work order on the first fit's item, completed, with the summary saying "No piece: the client decided against the fit".

The mirror keeps both: a visit FSM still holds on the first fit's item keeps the product it was fitted with, and a declined one stays a consultation (`src/domain/fsm-mirror.ts`). A one visit closed partly done, or as a no-show, stays `booked`, with nothing charged or sent, and ops follow it up from the Tasks board as any visit so closed.

### Payment at the visit

**A Razorpay payment link** (`createPaymentLink`, `src/providers/payments/razorpay.ts`, `POST /v1/payment_links`; the stub stands in locally and in every test) for the product's price in the price book on the visit's day, with GST, for the whole amount, under the visit's ID as its reference. **Razorpay texts it to the client by its own SMS**, and reminds them: it needs no secret beyond the keys staging and production already hold, and no message template or WhatsApp consent of ours (ADR 0025, item 91). The technician's close-out says it was texted, and then that it is paid; no amount reaches his phone.

**One link a visit, and a close that always lands.** The link's row (`payment_links`) is written before Razorpay is asked, and the close asks once and lands, `202`, whatever Razorpay answers: the phone's outbox is one ordered queue for every job, and a 5xx would have held the rest of the day's steps on the phone. A link the close could not have made, for a timeout, a 5xx, a 401 or a missing key, is asked for again by the five-minute cron's `payment_links` job, five a run at most, two of the run's outside calls each, reading only the unsent rows by a partial index (ADR 0009); ops are told once it has failed three times. Razorpay refuses a second link under a reference it already holds, which is what a try whose answer never came leaves behind, so a refusal first looks for the link by its reference (`GET /v1/payment_links?reference_id=`) and keeps it, already texted: the client gets one link however the tries went. A link Razorpay refuses outright is not asked for again (`refused_at`), and ops are told once, with the visit's ID: they make one in Razorpay's dashboard under that reference (`src/domain/money/payment-links.ts`).

**Paid**: Razorpay's `payment_link.paid` names the link and its payment, and the webhook records the payment as the visit's (`appointment_id`, the client, kind `visit`, captured, with its reference and the link's split before GST), by the link's ID or, for one ops made by hand, its reference, the visit's ID, with or without a row of ours. From there it is any payment: Books records it and sets it against the visit's invoice (ADR 0044), a refund under the 14-day guarantee is made as any other and claws back an invite's credits (ADR 0048). **Unpaid**: the Tasks board's "Payment owed" lists every link still unpaid, sent or not, with the product and the amount, from the close, due in 48 hours (`task_sla_hours`), leading to the client's Payments tab; it goes once Razorpay says it is paid.

**An invite's credits wait for the payment** (ADR 0025, item 93, for the owner to confirm). A friend's first fit closed as done grants both sides their credits within five minutes (ADR 0048); a one visit's, only once a payment for it is in, by its link or one ops made by hand (`src/domain/referrals/referral-grants.ts`). Until then nothing was sold, and the fraud rules, which compare the two people's payments, would have none of the friend's to compare.

**The invoice** is FSM's, raised on its work order as for any finished visit, and issued only when it totals what the client was sold the visit for (ADR 0070): the payment once made, else the product's price. FSM's work order is on the first fit's item, so where the product's price differs from it the draft is held for ops (open point 169).

### The words

Every word this adds is a placeholder, for the owner (open points 45, 162 and 165): the form's choice and note, the confirmation's, the `/book` page's intro, the WhatsApp text, the technician app's and the console's. The terms' "Nothing is fitted at it" and `/book`'s "Nothing is fitted on the first visit" would no longer be true, so each now says what the one visit is; the terms' sentence is counsel's to approve (open point 165).

## Consequences

- **Migration 0061** adds three columns, a table and two triggers, all empty or 0 on every row there is, the triggers touching only one-visit requests; the Worker already deployed reads none of them.
- **The contract**: the consultation routes' `one_visit` for `first_fit`; the technician's job's `one_visit`, `products` and `payment_link`, the badge `at_visit`, the piece step's `product` and `declined`; the dispatch board's badge; the Tasks board's `payment_owed`; regenerated documents and types.
- **Razorpay**: payment links enabled on the account, and the webhook subscribed to `payment_link.paid` on staging and production (provisioning, step 11c; open point 166).
- **A cron job**, `payment_links`, before the invoices, at most ten of the run's 40 outside calls, and none when no link waits.
- **Prepayment** (`src/policy/prepayment.ts`, "Every visit is prepaid at booking") holds for every visit but this one, which the owner ruled is paid for at the visit; the technician still never handles money, since Razorpay takes it.
- Tests: `test/worker/site/consultations.test.ts` and `referrals.test.ts` (the booking, its three hours on the first fit's item, nothing paid, the evening refused, the request while booking is off, the consultation it counts as); `test/worker/booking/one-visit.test.ts` (the card, the piece step's choice, the link made once, a close that lands while Razorpay is down and the cron that sends it after, a link made by a try whose answer never came, a refusal, the decline, the mirror, no invoice, the webhook, a link made by hand, the task, the request and the mark while booking is off); `test/worker/referrals/referral-grants.test.ts` (no credits until the payment); `test/worker/ops/ops-no-shows.test.ts` (no charge); `test/worker/vendors/razorpay-client.test.ts` (the link's calls); `test/node/policy/policy-one-visit.test.ts`; `e2e/book.e2e.ts`, `e2e/refer-landing.e2e.ts` and `e2e/tech/steps.e2e.ts`, with axe. The tests of the first fit asked for on the form went with it, the owner's ruling having taken the choice away.

## What this does not do

- **It does not offer the evening.** The owner's evening visit that ends by 8 pm waits for window times part B, which counts a visit's minutes against the day's times (open point 170).
- **It does not change FSM's item** to the product chosen, or to the consultation's when the client declines: no call that changes a work order's line has been tried on the org (open point 169).
- **It does not track pieces in the stock ledger.** A piece fitted is FSM's asset, as any first fit's; the ledger keeps consumables (ADR 0087). How many pieces of each base a kit carries is the owner's to say (open point 168).
- **It does not name the one visit in the client app**, whose visits list it as a first fit with nothing prepaid.
- **It does not send the link on WhatsApp.** Razorpay's SMS reaches the client without a template or consent of ours; a WhatsApp copy can follow with the owner's words.

**Confirmed by the owner, 1 October 2026:** an unpaid one visit carries no no-show charge and no late-move fee; the payment link goes by Razorpay's SMS; a visit declined at the door is a free consultation; an invited friend's referral visits land once the one visit's payment is in.
