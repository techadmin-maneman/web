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
   fitted") and its payments line name the Razorpay link. Two lines describe visits that, while online payment is off
   (ADR 0209), are paid at the visit and recorded by ops, never through a link: so they name no way to pay at all, and
   neither names UPI. A visit still to pay reads "Pay {amount} at the visit"; a visit ops book on WhatsApp reads "We
   book it with you on WhatsApp, and tell you how to pay {price}.", true whether online payment is on or off.

## Consequences

- The terms and the privacy policy, counsel's text, name UPI among the ways to pay. They are not the redesign's copy;
  they are left for counsel, and the redesign's report lists them.
- ADR 0209's mode with online payment off still has ops record a UPI payment taken at the visit, and its WhatsApp
  message (`visit_booked_at_visit_v1`) still says "Pay {{6}} by UPI to Mane Man at the visit". Whether the mode goes,
  as production's Razorpay-only switch would make it, is the owner's; the report lists it.
