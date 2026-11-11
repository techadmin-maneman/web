# 0246. Closed, and a step sent back

- Status: accepted
- Date: 2026-11-11
- Topic: Field work
- Amends [0245](0245-the-steps.md), which stands except on when the items its section 7 names for PR 7 come: PR 7b
  ("Left for later")

## Context

PR 7 of the technician redesign (`docs/technician-redesign/PLAN.md`) covers what happens after a step: the close, the
uploads still on the phone, a job that changes under the technician, and ops sending a step back (the plan's gap 5).
The owner approved its API changes on 11 November 2026: ops send back a step with a reason, the technician resends an
unpaid payment link, "Finish the work" asks ops for a time, and "Book the first fit" closes a consultation and fit as a
consultation going ahead. The same day they asked that a set of photographs can be sent back too.

## Decision

1. **Ops send a landed step back from the visit's drawer on the dispatch board, with why**
   (`POST /api/visits/{id}/send-back`, Operations · Act). A step that takes a correction can be sent back: either set
   of photographs, the checklist, the consumables, and a fit's hair system. A one visit's hair system is its decision
   and the source of its payment link, so it is never sent back (`src/policy/in-job-steps.ts`). One is open at a time
   for each step of a visit (`step_send_backs`). The audit entry names the visit and the step, never the reason.
2. **The technician's card carries what was sent back** (`sent_back`, with the reason and when), and the phone opens
   the step again with the reason in red. The day's list carries the visits to fix, of any day, naming the client only
   while the visit is unlocked, as the list does (`src/policy/job-visibility.ts`): past it, the visit by its kind.
3. **A step sent back lands even after the close, however long after,** until it lands again, which clears it. Every
   other step keeps the hour after the close that a corrected checklist or count has (ADR 0038).
4. **A retake keeps one photograph an angle.** The new take replaces the angle's photograph, and the take it replaced
   goes from storage with its small copy. This holds for the camera's own Retake too, which until now left the first
   take in storage with nothing naming it.
5. **Closed is redrawn** (`apps/tech/src/steps/CloseOut.tsx`): the result as the heading ("Visit closed", "Closed as
   no-show", "Closed, not fitted"), the client, the visit and the result beneath, the rows, then what follows from the
   result. A no-show keeps its evidence in place of the rows.
6. **A one visit's payment link can be texted again from Closed** (`POST /api/tech/jobs/{id}/payment-link/resend`),
   by the same code as ops' Resend, three times a day at most for a visit, so a tap cannot flood the client.
7. **A visit left partly done, or not fitted, asks ops for a time to finish it** (`POST /api/tech/jobs/{id}/finish-ask`):
   tomorrow morning, tomorrow evening, or ops to call the client. The choice is kept on the visit's outcome
   (`visit_outcomes.finish_ask`), and ops read it on the visit's Partly done task, where they book the visit as before.
8. **A job ops cancelled, or gave to another technician, under the phone opens a dialog once** over whatever screen is
   showing (`apps/tech/src/frame/Interrupted.tsx`), with Call ops and Back to Today. The prototype says the work so far
   is "saved and sent to ops"; the phone keeps it in Pending uploads, as it did, so the dialog says that. The banner
   above every screen goes on saying it.
9. **Pending uploads and the error screen take the new look**: Pending uploads with "n waiting" under its title and
   each job's state in the new words (Uploading, No signal, Failed), keeping every action it had.
10. **The technician app's 150 KB counts what ships.** A local build's parts page, which no phone is served, is left out
    of the count (`scripts/lib/spa-build.ts`).

## Left for later

- **Photos on Wi-Fi only.** The API takes a visit's steps in their order, so photographs held back for Wi-Fi would hold
  every later step of the visit, its close among them, until the phone found Wi-Fi. That needs the owner's word before
  it is a switch.
- **Options as a step with the client's pick, the one visit's "When" (Book the first fit), checking a label as it
  reads, matching the hair system to a profile measured with no signal, and the door's rare cases** move from PR 7 to
  PR 7b, which follows it, so this PR stays one to review. ADR 0245 named PR 7 for them.

## Consequences

- The visit's drawer lists what is sent back and offers Send back only for a landed step that may be sent back now
  (`may_send_back` on the visit's story), so the rule lives in one place.
- The table is keyed on the visit, so a client's erasure deletes their visits' rows; it holds no client's own words.
- The shipped technician app is at 146 KB of its 150 KB, every script counted, as its service worker caches them all.
  The screens still to come will need more than the 4 KB left.
