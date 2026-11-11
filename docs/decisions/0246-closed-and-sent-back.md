# 0246. Closed, and a step sent back

- Status: accepted
- Date: 2026-11-11
- Topic: Field work
- Follows [0245](0245-the-steps.md)

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
   the step again with the reason in red.
3. **A step sent back lands even after the close, however long after,** until it lands again, which clears it. Every
   other step keeps the hour after the close that a corrected checklist or count has (ADR 0038).
4. **A retake keeps one photograph an angle.** The new take replaces the angle's photograph, and the take it replaced
   goes from storage with its small copy. This holds for the camera's own Retake too, which until now left the first
   take in storage with nothing naming it.

## Consequences

- The visit's drawer lists what is sent back and offers Send back only for a landed step that may be sent back now
  (`may_send_back` on the visit's story), so the rule lives in one place.
- The table is keyed on the visit, so a client's erasure deletes their visits' rows; it holds no client's own words.
