# 0269. The design check's API side

- Status: accepted
- Date: 2026-11-17
- Topic: Field work
- Builds on [0267](0267-the-technician-design-check.md) and [0268](0268-the-visits-design-check.md), whose check it ends
- Amends [0267](0267-the-technician-design-check.md), [0106](0106-a-clients-hair-profile.md) and [0053](0053-the-technician-app-offline.md):
  what a past visit used, and the job card's client block

## Context

The design check of 17 November 2026 ([0267](0267-the-technician-design-check.md)) left seven of the prototype's states
for last, because the API did not yet give the phone what they show.

## Decision

1. **The client's history says which visits were the technician's own**: each visit carries `yours`, and the phone
   names the technician of one of theirs "You", as the prototype does.
2. **What a past visit used reads in the unit the stock counts it in**: each thing carries its unit, so the history
   writes "5 tape strips · 10 ml solvent". [0267](0267-the-technician-design-check.md)'s departure, a count after each
   name, no longer holds but for a thing used before the stock had codes, which has no unit to give.
3. **The job card's client block is the prototype's for each kind of visit.** A service or a replacement has "Hair
   profile", its last visit's day at the head's end, and the hair system, base, colour, fixing and scalp. A first fit
   has "From the consultation", dated by the profile, with what the client chose, the Norwood stage, base, colour and
   fixing. A consultation has "Booking": where it was booked and how it is paid. Each hold now keeps where it was made,
   the client's app, the site or ops (`slot_holds.booked_from`), and the card gives the first hold booked as the visit
   (`booked_via`); a visit booked before has none, and its card says only how it is paid. The card no longer shows the
   piece on the client's head, what was paid for, or the last visit's after photograph: the piece and what was paid
   for are the hair system step's ([0163](0163-pieces-scanned-from-the-kit.md)), and the last visit's photographs are
   the handoff's and the history's. [0106](0106-a-clients-hair-profile.md)'s piece card, read from the profile, is this
   block.

## Consequences

The API still serves the last visit's after photograph (`GET /api/tech/jobs/{id}/last-visit-photo`, from
[0053](0053-the-technician-app-offline.md)) to a phone on an earlier build; it goes once no phone runs one.

The check's report, kept as the owner's tracker, marks each of these findings with its PR.
