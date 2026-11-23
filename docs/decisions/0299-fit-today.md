# 0299. Fit today: a consultation becomes the fit at the door

- Status: accepted
- Date: 2026-11-23
- Topic: Booking and visits
- Amends [0105](0105-a-consultation-and-fit-in-one-visit.md): a consultation and fit in one visit may also be booked
  by the technician at the door, at a plain consultation just closed

## Context

A client who books a plain consultation and, once measured, wants to be fitted there and then, had to be booked a
first fit for another day: only a visit booked as "Consultation and fit" could fit on the spot. The owner ruled on 22
and 23 November 2026: where the technician's kit holds a piece made exactly to the client's profile and their day has
room, the technician books the fit at once and fits the client there, as a one visit: the piece scanned from the kit,
paid the same day by link once fitted. Two defaults stand: the client agrees to the terms in their own app before the
fit, and Fit today is not offered where the client has a first fit booked already, which ops move instead.

## Decision

1. **Offered at a plain consultation the technician has closed as done today** (`fitTodayOf`,
   `src/domain/booking/fit-today.ts`; `GET /api/tech/jobs/{id}/fit-today`), where all of these hold:
   - the close says the client is going ahead with a fit, with no reason not to, and was made on the phone and reached
     us no longer ago than the technician may check in ahead of a start (the phone clock's `before_start`), so they are
     still at the door: a close sent late, once signal came back, is not;
   - the client has no first fit, consultation and fit, or consultation to come, nor a first fit's payment link ops
     sent still open (`liveVisitOf`, `linkStillOpen`), as ops booking one would refuse;
   - the client has agreed to today's terms in their own channel, on the site or in the app, as they booked
     (`agreedToToday`, `src/domain/privacy/terms-acceptances.ts`; ADR 0191): the owner's default that the client agrees
     in their own app, not the technician for them;
   - the technician's kit holds a piece of the stock code made exactly to the client's latest profile, free or kept
     for them (`stockMatch`, ADR 0173), of the product the client picked on Options where they picked one (ADR 0247);
   - the profile's product has a first fit on sale today;
   - the technician's day has a start for the fit's length from now, near enough to begin at once (no later than they
     may check in ahead of a start, the phone clock's `before_start`), in the morning or the afternoon, as a one
     visit is booked (ADR 0105).
2. **Booked by the booking engine, at the door** (`holdFitToday`; `POST /api/tech/jobs/{id}/fit-today`): a first fit
   marked as one visit, sold under its terms with nothing paid now, held with this technician as ops hold a visit with
   the technician they chose, so it is fixed, never a draft (ADR 0290), and confirmed at once. A visit booked at the
   door (`atTheDoor`, `src/domain/booking/start-offers.ts`) is offered today from now, whatever ops let clients book
   for today and the lead time they keep, and with the technician at the door though the rotation (ADR 0117) would bar
   them alone: the rotation is between visits, and this is the visit going on. Every other rule of a start stands,
   the drives either side asked of Google before it is held as at any booking (ADR 0287). Asked again once booked, as a
   tap after the phone stopped waiting for the first, it answers with the fit booked.
3. **Paid as any one visit**: the close as fitted asks for the product's payment link (ADR 0105); while online payment
   is off, the client pays by UPI at the visit (ADR 0209), and the offer says which.
4. **One tap books it, with no question after**: the offer says what the client pays and when the fit would start. The
   plan asked once more before booking; the shared confirmation (`ConfirmSheet`) asks before what cannot be taken back,
   with the answer drawn as a danger, and a booking ops can cancel is not that.

## Consequences

- The client's booking message for a one visit goes, as for any booked by ops: it says nothing is paid until they are
  fitted. Sending none would need a new value of `slot_holds.booked_from`, which its constraint refuses.
- A consultation that runs into the evening cannot become the fit, as a one visit is not booked in the evening.
- A client ops booked by phone, who has agreed to no terms in their own app or on the site, is not offered Fit today:
  asking them to agree in their app at the door is a change of its own.
- The technician's card for the fit opens at once, as any visit today's does.
