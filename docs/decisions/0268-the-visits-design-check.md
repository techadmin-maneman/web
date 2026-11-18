# 0268. The visit's design check

- Status: accepted
- Date: 2026-11-17
- Topic: Field work
- Builds on [0267](0267-the-technician-design-check.md), whose check and rulings it carries on through the visit
- Amends [0149](0149-lost-reasons.md), [0258](0258-the-technician-design-pass.md) and [0267](0267-the-technician-design-check.md):
  how a consultation closes, the camera's count, and a ruled list's gap

## Context

The design check of 17 November 2026 ([0267](0267-the-technician-design-check.md)) fixed the visit's screens last: the
door, the plan, the camera, the steps, a consultation and the closes. Building them against the prototype changed three
earlier records and kept two of the prototype's states out of reach of a web app.

## Decision

1. **A consultation asks at once whether the client goes ahead**, as the prototype draws it and the owner answered on
   17 November 2026: "Going ahead with a fit?" heads its outcome, Yes or Not now as radio rows, with no Result before
   it and no Summary, and it closes done. It no longer closes partly done. This replaces [0149](0149-lost-reasons.md)'s
   "Closing a consultation as Done asks"; Not now still asks why, from the same list.
2. **The camera's count names the angle in lower case**, "1 of 5 · front", as the prototype writes it.
   [0258](0258-the-technician-design-pass.md), decision 1, wrote it capitalised; the prototype is the source.
3. **A ruled list of choices keeps no gap between its rows**: the shared field's own styles load before the ruled list's,
   so its gap of none wins, and the technician app's rows are the prototype's 60 px from rule to rule.
   [0267](0267-the-technician-design-check.md)'s departure, rows held 8 px short against the choices' gap, no longer
   holds. The console's ruled lists and the client app's close up by the same 8 px.

## Departures from the prototype

- **A camera the phone refused** offers Try again where the prototype offers Open settings: a web app cannot open the
  phone's settings, so the line asks the technician to turn camera access on there and then try again. Once a photo is
  taken the strip and Done stay, so a set already on the phone is never lost to a camera that will not open again.
- **A no-show's close** lists the call and the door's photograph only where this phone kept them: a no-show closed on
  another phone, or by ops, says what the API knows.

## Consequences

The check's report, kept as the owner's tracker, marks each of the visit's findings with its PR.
