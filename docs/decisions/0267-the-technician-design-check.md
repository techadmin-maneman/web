# 0262. The technician app's design check

- Status: accepted
- Date: 2026-11-17
- Topic: Field work
- Builds on [0258](0258-the-technician-design-pass.md), whose rulings it keeps, and [0239](0239-technician-light-look.md),
  whose look each fix follows

## Context

After the design pass, the owner asked for the technician app to be set beside the approved prototype
(`design/tech-redesign/`) screen by screen and state by state, at 390 px, 360 px, with text at 130 % and in Hindi, and
for every difference no record explains to be fixed. The check found 100. Most came from a few shared places: the
list row's padding and title size in the look, a chosen chip only edged, two confirm sheets still dark, and three
screens carried over without the redesign's layout. Building the fixes against the same captures found a few more,
which were added to the same list.

## Decision

1. **The app matches the prototype's own values**, taken from its inline styles, in four PRs: the shared look first,
   then the tabs and the job, then the visit, then what needs the API. Each touched state is captured beside the design
   before it goes for review.
2. **The owner's answers of 17 November 2026**: a not-fitted reason as a setting, kept on the visit's outcome and shown
   on the rebook task; the hair system step without "Why it failed, if it did"; a consultation asks "Going ahead with a
   fit?" at once and can no longer close as partly done; signing out with work unsent says how many uploads will be
   lost, with Cancel and Sign out.
3. **Kept as built, and recorded here**, where the owner accepted the recommendation to keep:
   - Kit's "Hand back 1 hair system" and "Hand back expired stock": the hand-back is the kit's own workflow
     ([0164](0164-the-kit-screen.md)), which the prototype does not draw.
   - A closed job offers no Message and no Ask ops to reschedule: the visit is over, and View summary is its way on.
4. **Held to earlier rulings**, not changed: a chip and a control at the gloved 48 px ([0245](0245-the-steps.md)); a
   control's edge at 3:1 in `--stone` ([0239](0239-technician-light-look.md), [0258](0258-the-technician-design-pass.md)).

## Departures from the prototype

- **A job cancelled or moved under the phone** says when ops did it only where the API says: a move's time, or the push
  that told of it. A cancellation the phone learns of from a write the API refused carries no time, so the dialog says
  only that ops cancelled it.
- **What a past visit used**, in the client's history, names each thing with its count ("Walker tape × 2"): the API's
  history gives no unit, so the prototype's "10 ml solvent" waits for it to.
- **A ruled choice list** keeps the shared choices' 8 px between its rows, which wins over the list's own gap of none
  in `packages/ui`; the technician look sets its rows 8 px shorter so rule to rule is the prototype's 60 px, until the
  shared order is put right with the console's screens captured.
- **"Report missing" at 130 % text** wraps onto two lines: at the prototype's own padding and size it cannot fit half
  the width either.
- **Pending uploads** keeps, beside the prototype's row for each photo set, a row for a job's other writes, the time
  its oldest has waited on the phone (which is what an eviction would take), and every way it had to send, put right
  or let go of a job's work ([0246](0246-closed-and-sent-back.md), decision 9).

## Consequences

The check's report, kept as the owner's tracker, lists each finding with its PR and state. A later difference the
check missed is added there and fixed in the PR that touches its screen.
