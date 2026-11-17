# 0270. The one visit is paid through Razorpay only

- Status: accepted
- Date: 2026-11-17
- Topic: The site
- Amends [0269](0269-the-one-visits-note-on-book.md): consequences

## Context

ADR 0269 left the booked confirmation's line for the one visit saying it is paid by UPI at the visit, live copy
outside the redesign brief's list, for the owner to word. On 17 November 2026 the owner ruled that the one visit is paid
through Razorpay only.

## Decision

1. **The booked confirmation's line for the one visit** reads "{first fit's length} at home. Paid through a Razorpay
   link once you're fitted." (`referral.booked.ready.oneVisit`), in the approved note's words; the calendar entry it
   fills says the same.
2. **No site copy offers UPI** as a way to pay for a visit.

## Consequences

- The client app's card for the one visit still says it is paid by UPI at the visit (`apps/app/src/home/one-visit-words.ts`),
  and the terms and the privacy policy, counsel's text, name UPI among the ways to pay. Neither is the site redesign's
  copy; both are left for the owner and counsel, and the redesign's report lists them.
