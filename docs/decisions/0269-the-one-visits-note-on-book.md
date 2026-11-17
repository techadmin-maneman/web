# 0269. The one visit's note on `/book`

- Status: accepted
- Date: 2026-11-17
- Topic: The site
- Amends [0265](0265-book-and-try-on-the-client-apps-look.md): decision 5

## Context

ADR 0265 gave the one visit's note on `/book` in ADR 0257's way, paid through a Razorpay link once fitted, and marked it
`PLACEHOLDER` until the owner gave its words. The owner approved the brief's words as written on 17 November 2026.

## Decision

1. **The note reads** "Paid through a Razorpay link once you're fitted. Decide against it and you pay nothing.", with
   no `PLACEHOLDER` mark (`referral.consultation.plan.oneVisitNote`).
2. **A phone shows it alone**, as the board draws its one line. A laptop shows it after the live note's first two
   sentences, when the visit starts and that the hair system is chosen and fitted there and then; the live note's
   sentence that said it was paid by UPI at the visit gives way to it.

## Consequences

- The booked confirmation's line for the one visit (`referral.booked.ready.oneVisit`) still says it is paid by UPI at
  the visit. It is live copy outside the brief's list of changes, so it stays until the owner rewords it; the redesign's
  report lists it.
