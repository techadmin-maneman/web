# 0051. Booking from the site is the landing's booking

- Status: accepted. Amended by ADR 0060: while self-serve booking is off, the page records a request for ops rather than refusing. Amended by [ADR 0081](0081-the-site-takes-the-address.md): the consultation form takes the full address. Amended by [ADR 0089](0089-an-invite-is-not-lost.md): the page books with an invite the visitor's browser remembers, and its confirmation then says what the landing's does. Amended 28 September 2026: both pages refuse alike, and each error code answers with one status (item 105); `POST /api/lead` and `GET /api/cities` are removed (item 107).
- Date: 2026-09-23

## Context

Two pages on the public site take someone who wants a visit:

- **`/book`**, the site's own, which since Phase 1 has taken a name, a number, a city and a rough preference — weekday or weekend, morning or evening — and written a **lead**. Ops then fixed the hour on WhatsApp. It never booked anything: the "proposed visit date" it showed was a guess from `VISIT_LEAD_DAYS`.
- **`/r/:code`**, the referral landing (ADR 0027), which since P2-M3 asks for a pincode and, where we come, books a real consultation: a date, a window from 9–12, 12–4 or 4–8, and a slot held for ten minutes while the form is filled in. (Corrected 27 September 2026: nothing is held while the form is filled in. The slot is held when the form is sent, and confirmed as it is held; ADR 0081.)

The owner asked on 22 September 2026 why the site still offered the four vague windows, and for the end-to-end test on staging to cover the public page. The answer was only history: `/book` predates self-serve booking, and at the time we knew a visitor's city but not their pincode, so we could not tell whether we served them.

We can now. `serviceable_pincodes` holds 198 NCR pincodes, and `GET /api/pincodes/{pin}` answers whether a technician works there.

## Decision

**The site's booking page is the referral landing without the invite.** One island serves both (`site/src/islands/Invite.tsx`, with a `mode`), and one path in the API serves both (`src/domain/booking/public-booking.ts`), so the two pages cannot drift apart:

- `POST /api/consultation` and `POST /api/waitlist` are the landing's two routes without the code. They take the same Turnstile token, the same daily limits per number and address, the same consent notices, and hold the same slot.
- **Amended 27 September 2026 (audit finding FEO-21).** All four take the `Idempotency-Key` the page sends with each submission, as `POST /api/lead` did (ADR 0011): the same submission sent again gets its first answer rather than a second lead, and a refusal frees the key. They ignored it before, so a press repeated after a lost answer was refused `already_booked`, or listed the number twice.
- **Amended 28 September 2026 (`docs/open-points.md`, item 105).** Both pages refuse a submission alike: a pincode we do not serve, a day outside the fortnight, a number past consultations, or a waitlist entry for a pincode we serve is `422 not_bookable`, which the form words "That day is no longer open"; an address in another pincode is `400 invalid_request` naming `address.pincode`. The site's routes answered the first two, and the address, `422 invalid_request` before, where the landing rewrote them; the owner ruled that `invalid_request` answers 400 everywhere.
- The public page shows no card and no invite, and asks **where the hair loss is**, as Phase 1's form did, because that answer is worth having and an invited friend is never asked it.
- **Every booking still leaves a lead**, so the CRM funnel sees what it saw in Phase 1. The lead carries the date the person actually booked, not a guess.

`SELF_SERVE_BOOKING` still governs it. While the flag is off, the page books nothing and records a request for ops, answered `201` with `state: "requested"`, and says ops will fix the hour on WhatsApp, exactly as the landing does. (Until 24 September 2026 it answered `409 ops_assisted`; [ADR 0060](0060-an-invited-friend-reaches-ops-and-the-crm.md) changed both pages. Corrected 27 September 2026.)

## Consequences

- **The four rough windows are gone from the site.** A visitor picks a day in the next fortnight and one of the three real windows, and the slot is held for them.
- **A booking from the site leaves a lead; a booking from an invite does not.** `leads.loss_extent` is required, and only the site's own form asks where the hair loss is. Migration 0025 set out to make the column optional by rebuilding the table, and was withdrawn: a try-on job points at a lead, and D1 runs a migration in one transaction, where SQLite counts dropping the parent as a violation that re-creating it does not undo. `first_choice_window` was already optional. The gap — an invited friend reaching FSM and the referral records but not the CRM — is `docs/open-points.md`, item 119. (Corrected 27 September 2026: migration 0031 made `leads.loss_extent` optional, and a booking from an invite leaves a lead too; see ADR 0060.)
- **The consent is recorded once**, under the notice the page actually showed — `referral-consultation-v1` for a booking, `waitlist-v1` for the list — instead of Phase 1's booking notice.
- **A pincode we do not know** is treated as one we do not serve: the page takes the number for it. The 198 pincodes are NCR's; someone outside it joins a list with no area named.
- **`/book`'s fidelity pairs move** to the referral harness, because the Phase 1 design's booking board no longer describes the page. The Phase 2 design has no board for a public booking; boards C2 to C4 are that page, minus the invite.
- **`/api/lead` stays.** The try-on's gate still creates leads through it, and nothing else changes for them. (Corrected 25 September 2026: the try-on's gate writes its lead through `POST /api/tryon/claim`, not `/api/lead`, and no page of the site calls `/api/lead` or `/api/cities` any more. Both stay in the API for now; the site's own copies of them were removed as dead code. Removed 28 September 2026 on the owner's ruling (`docs/open-points.md`, item 107): the staging check and the load test book through `POST /api/consultation`, and the checks every form makes of the person, which `/api/lead`'s tests held, are `test/worker/site/public-form.test.ts`. The path that sent Phase 1's leads to FSM as Requests stays for a lead the route left waiting, and goes with item 159.)

## What this does not do

- It does not take payment. A consultation is free, and prepayment is for the fit, in the client app (ADR 0045).
- It does not ask for an address. The pincode is enough to know whether we come; the technician takes the rest on WhatsApp, as before. (Overruled 27 September 2026 by the owner: the consultation form takes the full address before it books, and it becomes the person's; ADR 0081.)
