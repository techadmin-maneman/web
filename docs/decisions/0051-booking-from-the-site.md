# 0051. Booking from the site is the landing's booking

- Status: accepted
- Date: 2026-09-23

## Context

Two pages on the public site take someone who wants a visit:

- **`/book`**, the site's own, which since Phase 1 has taken a name, a number, a city and a rough preference — weekday or weekend, morning or evening — and written a **lead**. Ops then fixed the hour on WhatsApp. It never booked anything: the "proposed visit date" it showed was a guess from `VISIT_LEAD_DAYS`.
- **`/r/:code`**, the referral landing (ADR 0027), which since P2-M3 asks for a pincode and, where we come, books a real consultation: a date, a window from 9–12, 12–4 or 4–8, and a slot held for ten minutes while the form is filled in.

The owner asked on 22 September 2026 why the site still offered the four vague windows, and for the end-to-end test on staging to cover the public page. The answer was only history: `/book` predates self-serve booking, and at the time we knew a visitor's city but not their pincode, so we could not tell whether we served them.

We can now. `serviceable_pincodes` holds 198 NCR pincodes, and `GET /api/pincodes/{pin}` answers whether a technician works there.

## Decision

**The site's booking page is the referral landing without the invite.** One island serves both (`site/src/islands/Invite.tsx`, with a `mode`), and one path in the API serves both (`src/domain/public-booking.ts`), so the two pages cannot drift apart:

- `POST /api/consultation` and `POST /api/waitlist` are the landing's two routes without the code. They take the same Turnstile token, the same daily limits per number and address, the same consent notices, and hold the same slot.
- **Amended 27 September 2026 (audit finding FEO-21).** All four take the `Idempotency-Key` the page sends with each submission, as `POST /api/lead` does (ADR 0011): the same submission sent again gets its first answer rather than a second lead, and a refusal frees the key. They ignored it before, so a press repeated after a lost answer was refused `already_booked`, or listed the number twice.
- The public page shows no card and no invite, and asks **where the hair loss is**, as Phase 1's form did, because that answer is worth having and an invited friend is never asked it.
- **Every booking still leaves a lead**, so the CRM funnel sees what it saw in Phase 1. The lead carries the date the person actually booked, not a guess.

`SELF_SERVE_BOOKING` still governs it. While the flag is off, the page answers `ops_assisted` and says booking goes through WhatsApp for now, exactly as the landing does.

## Consequences

- **The four rough windows are gone from the site.** A visitor picks a day in the next fortnight and one of the three real windows, and the slot is held for them.
- **A booking from the site leaves a lead; a booking from an invite does not.** `leads.loss_extent` is required, and only the site's own form asks where the hair loss is. Migration 0025 set out to make the column optional by rebuilding the table, and was withdrawn: a try-on job points at a lead, and D1 runs a migration in one transaction, where SQLite counts dropping the parent as a violation that re-creating it does not undo. `first_choice_window` was already optional. The gap — an invited friend reaching FSM and the referral records but not the CRM — is `docs/open-points.md`, item 50. (Corrected 27 September 2026: migration 0031 made `leads.loss_extent` optional, and a booking from an invite leaves a lead too; see ADR 0060.)
- **The consent is recorded once**, under the notice the page actually showed — `referral-consultation-v1` for a booking, `waitlist-v1` for the list — instead of Phase 1's booking notice.
- **A pincode we do not know** is treated as one we do not serve: the page takes the number for it. The 198 pincodes are NCR's; someone outside it joins a list with no area named.
- **`/book`'s fidelity pairs move** to the referral harness, because the Phase 1 design's booking board no longer describes the page. The Phase 2 design has no board for a public booking; boards C2 to C4 are that page, minus the invite.
- **`/api/lead` stays.** The try-on's gate still creates leads through it, and nothing else changes for them. (Corrected 25 September 2026: the try-on's gate writes its lead through `POST /api/tryon/claim`, not `/api/lead`, and no page of the site calls `/api/lead` or `/api/cities` any more. Both stay in the API for now; the site's own copies of them were removed as dead code.)

## What this does not do

- It does not take payment. A consultation is free, and prepayment is for the fit, in the client app (ADR 0045).
- It does not ask for an address. The pincode is enough to know whether we come; the technician takes the rest on WhatsApp, as before.
