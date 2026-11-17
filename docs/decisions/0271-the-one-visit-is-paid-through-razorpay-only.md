# 0271. The one visit is paid through Razorpay only

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
3. **The client app says the same**, as the owner asked the same day: the one visit's card ("By a Razorpay link, once
   fitted"), the payments line, the booking made with ops and a visit still to pay while online payment is off (ADR
   0209) each name the Razorpay link, never UPI at the visit.

## Consequences

- The terms and the privacy policy, counsel's text, name UPI among the ways to pay. They are not the redesign's copy;
  they are left for counsel, and the redesign's report lists them.
- ADR 0209's mode with online payment off still lets ops record a UPI payment taken at the visit. The app no longer
  tells the client to pay that way; whether the mode itself goes is the owner's, and the report lists it.
