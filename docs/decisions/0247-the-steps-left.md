# 0247. The steps left from PR 7

- Status: accepted
- Date: 2026-11-11
- Topic: Field work
- Builds on [0245](0245-the-steps.md) and [0246](0246-closed-and-sent-back.md), which left these items for later, and
  [0105](0105-a-consultation-and-fit-in-one-visit.md), whose one visit gains a fit booked for another day

## Context

ADR 0245 left five items of the visit's steps for later, and ADR 0246 moved them to PR 7b of the technician redesign
(`docs/technician-redesign/PLAN.md`). These were Options as a step of the consultation with the client's pick, the one
visit's "When", checking a label as soon as it reads, matching the hair system to a profile measured with no signal, and
the door's rare cases. On 11 November 2026 the owner made four rulings:

- a consultation's pick goes with its close and is shown to ops;
- a one visit's fit booked for another day closes the visit as a consultation going ahead, with nothing taken that day,
  and is paid at its own visit;
- the technician app's JavaScript budget rises to 200 KB;
- there is no "Photos on Wi-Fi only" switch.

## Decision

1. **Options opens a consultation's outcome** and shares its place in the visit's bar, as Colour and style shares the
   hair profile's (ADR 0245). Each product on the card is shown with its prices incl. GST, as the price book has them that
   day, and the client's try-on looks beneath. A radio marks the client's pick, and the action goes on to the outcome.
   The products are the card's, so a pick can be made with no signal; the prices and looks need signal, and say so when
   they cannot load. The job's own Options screen stays, and can be opened at any point of the visit.
2. **The pick goes with a yes.** The outcome's `done` takes `product`, a tier, with `going_ahead` true: on a
   consultation, a product offered on the visit's day; on a one visit, only the one its fit was booked for later with.
   Any other close with a product is refused. It is kept on the visit's outcome (`visit_outcomes.picked_tier`), and a
   close with no pick keeps none. With a yes, the outcome names the pick.
3. **Ops read the pick on the client's First fit to book task,** by the product's name ("· picked Mane Man Natural"),
   so the call to book the fit starts from what the client chose.
4. **The pick is kept on the phone as it is made** (`options_draft`, one at a time, as the other drafts are), so leaving
   the step or closing the app loses none of it. It goes once the close is sent. A pick of a product no longer on the
   card is not sent. A refused close opens on the close itself, with the pick it sent.
5. **A one visit's fit can be booked for another day.** Once a product is chosen at the head of the hair system step,
   "When" offers Fit today, the default, or Book the first fit. Fit today is open only while the kit holds a piece of
   the product, as the brief draws it; a product the kit does not hold is booked for later. The payment link stays at
   the close, as the owner answered on 10 November, so there is no "Send link and start the fit". A fit booked for
   later sends the piece step as `{product, fit_later: true}` and asks for no label. The visit then runs as a declined one does: the consultation's
   checklist alone, nothing expected of the kit and no reason asked where nothing was used, and no photographs after. Its close, done, goes ahead with the product
   as the client's pick, so ops see it on the First fit to book task; a close saying the client is not going ahead is
   refused. The visit becomes a consultation with nothing
   charged or sent (`one_visit` reads `declined`: fitted nothing that day), and the fit is booked and paid as any first
   fit. The card's `client_choice` carries `fit_later`.
6. **A label is checked as soon as it reads,** with no tap: "Checking the label…" while the API looks it up, and
   "Check again" only once a look-up has found no signal.
7. **The kit is matched to the profile measured today:** the one still on the phone, as with no signal, else the
   card's.
8. **The door's rare cases.** A check-in refused as early, then made again with no signal, waits at the door, since the
   tap still on its way outranks the refusal. A no-show refused as early keeps its refusal until one lands. A check-in
   measured too far offers Try again at once, from the last answer read whole, while the outbox is read again.
9. **The technician app's budget is 200 KB** of gzipped JavaScript on a first load; the client app's and the console's
   stay 150 KB (`scripts/lib/spa-build.ts`).
10. **Photographs go on any signal.** No switch holds them for Wi-Fi, since the API takes a visit's steps in their order
    and a held set would hold the close behind it.

## Consequences

- A consultation's bar keeps four places. Options and the close are two pages of its outcome, as Colour and style is
  a page of the hair profile.
- A client who goes ahead without a pick is still a First fit to book task, with no product named.
- A one visit closed with its fit booked for later reads `declined` in `appointments.one_visit`, which the table's check
  allows; its outcome says the client is going ahead. A state of its own would mean rebuilding `appointments`.
- Migration 0206 only adds a column, which the Worker already deployed never reads.
