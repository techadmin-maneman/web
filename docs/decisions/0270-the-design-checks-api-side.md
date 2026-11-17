# 0270. The design check's API side

- Status: accepted
- Date: 2026-11-17
- Topic: Field work
- Builds on [0267](0267-the-technician-design-check.md) and [0268](0268-the-visits-design-check.md), whose check it ends
- Amends [0267](0267-the-technician-design-check.md), [0106](0106-a-clients-hair-profile.md), [0053](0053-the-technician-app-offline.md), [0188](0188-failure-rates-and-value-at-risk.md) and [0169](0169-supplier-claims.md):
  what a past visit used, the job card's client block, and failures no longer recorded from the step

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
4. **"Can't fit today" asks why**, as the owner answered on 17 November 2026
   ([0267](0267-the-technician-design-check.md), decision 2): a light sheet with the reasons ops keep in Settings, Job
   sheet, beside the partial and lost reasons (`not_fitted_reasons`; the prototype's four until ops save their own),
   and "Close and tell ops" off until one is picked. The close keeps it on the visit's outcome
   (`visit_outcomes.not_fitted_reason`); ops read "Not fitted · Piece damaged" on the partly done visit's task and on
   the client's page. A phone on an earlier build closes with no reason, as it did.
5. **A fit closed not fitted** lists, as the prototype does, Result ("Not fitted · Piece damaged"), Photos and Next
   step ("Ops rebook the fit"), and Finish the work beneath.
6. **The hair system step is scan-first**: "Scan the hair system", what is expected (the product paid for, chosen or
   fitted new, its spec, and the piece it replaces), the camera live with "Type the code" and "Can't fit today" beneath
   it, then the piece confirmed, against the profile ("Match") and the kit ("1 left after this"), with Rescan. The step
   asks for the scan alone: the base and the lot come from the label's check, the hair system from the kit's piece, and
   the piece that came off is the one the card has on the client's head. "Why it failed, if it did" is no longer asked
   (the owner's answer of 17 November 2026).
7. **The API refuses a consultation closed partly done** (error field `outcome`): it closes done, going ahead or not
   ([0268](0268-the-visits-design-check.md), decision 1). A consultation and fit in one visit may still close partly
   done, as "Can't fit today" closes it.

## Departures from the prototype

- **The code typed** is checked as it reads, with no Check button ([0247](0247-the-steps-left.md), decision 6).
- **Kit stock whose pieces carry no labels**, taken in before its pieces were labelled, is picked beneath the scanner
  from "From your kit", the label on the piece then typed: a scan cannot find it.
- **A replacement whose client has no piece on the head**, by the card, shows no Replacing row and sends no piece that
  came off: the step no longer takes one typed, so such a piece reaches neither the kit's hand-back nor the claims list.
- **A step opened again** after its piece landed replaces the piece worn before the visit's day, never the one it
  fitted.
- **The sheet's Close** is the shared sheet's, on the dark backdrop, where the prototype's backdrop is a bare target.

## Consequences

No piece is recorded as failed from the step any more: a piece that came off is replaced
([0191](0191-a-replaced-piece-comes-off.md)), and the API's failure reason, which no screen now sends, is the only way
`pieces.failed_at` was written. From now on the Quality page's failure rates ([0188](0188-failure-rates-and-value-at-risk.md)), a
returned piece's reason on the claims list ([0169](0169-supplier-claims.md)) and the pieces tab's "Came off" count no
failure of a piece fitted after this, until failures are recorded some other way. The owner was told this with the PR.

A Worker rolled back past this reads a close kept with a not-fitted reason as having no outcome, as one rolled back past
`cannot_fit` did.

The API still serves the last visit's after photograph (`GET /api/tech/jobs/{id}/last-visit-photo`, from
[0053](0053-the-technician-app-offline.md)) to a phone on an earlier build; it goes once no phone runs one.

The check's report, kept as the owner's tracker, marks each of these findings with its PR.
