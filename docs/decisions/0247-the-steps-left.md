# 0247. The steps left from PR 7

- Status: accepted
- Date: 2026-11-11
- Topic: Field work
- Builds on [0245](0245-the-steps.md) and [0246](0246-closed-and-sent-back.md), which moved these items to PR 7b

## Context

ADR 0245 left five items of the visit's steps for later, and ADR 0246 moved them to PR 7b of the technician redesign
(`docs/technician-redesign/PLAN.md`). These were Options as a step of the consultation with the client's pick, the one
visit's "When", checking a label as soon as it reads, matching the hair system to a profile measured with no signal, and
the door's rare cases. On 11 November 2026 the owner ruled that a consultation's pick goes with its close and is shown
to ops.

## Decision

1. **Options opens a consultation's outcome** and shares its place in the visit's bar, as Colour and style shares the
   hair profile's (ADR 0245). Each product on the card is shown with its prices incl. GST, as the price book has them that
   day, and the client's try-on looks beneath. A radio marks the client's pick, and the action goes on to the outcome.
   The products are the card's, so a pick can be made with no signal; the prices and looks need signal, and say so when
   they cannot load. The job's own Options screen stays, and can be opened at any point of the visit.
2. **The pick goes with a yes.** The outcome's `done` takes `product`, a tier, only on a consultation (not a one visit)
   with `going_ahead` true, and only for a product offered on the visit's day. Any other close with a product is
   refused. It is kept on the visit's outcome (`visit_outcomes.picked_tier`), and a close with no pick keeps none.
   With a yes, the outcome names the pick.
3. **Ops read the pick on the client's First fit to book task,** by the product's name ("· picked Mane Man Natural"),
   so the call to book the fit starts from what the client chose.
4. **The pick is kept on the phone as it is made** (`options_draft`, one at a time, as the other drafts are), so leaving
   the step or closing the app loses none of it. It goes once the close is sent. A pick of a product no longer on the
   card is not sent. A refused close opens on the close itself, with the pick it sent.
5. **A label is checked as soon as it reads,** with no tap: "Checking the label…" while the API looks it up, and
   "Check again" only once a look-up has found no signal.
6. **The kit is matched to the profile measured today:** the one still on the phone, as with no signal, else the
   card's.
7. **The door's rare cases.** A check-in refused as early, then made again with no signal, waits at the door, since the
   tap still on its way outranks the refusal. A check-in measured too far offers Try again at once, from the last answer
   read whole, while the outbox is read again.

## Consequences

- A consultation's bar keeps four places. Options and the close are two pages of its outcome, as Colour and style is
  a page of the hair profile.
- A client who goes ahead without a pick is still a First fit to book task, with no product named.
- Migration 0206 only adds a column, which the Worker already deployed never reads.

## Left for later

- **The one visit's "When"** (Fit today, or Book the first fit, which closes it as a consultation going ahead) is PR
  7c. With payments taken at the visit, a link sent at the close for a fit not yet made has nothing to settle against.
  A link that is paid would also need to become a first fit paid ahead and still to book, which is a payments change.
  How the fit is paid needs the owner's word first.
