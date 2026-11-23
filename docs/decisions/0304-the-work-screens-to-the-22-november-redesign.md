# 0304. The Work screens, to the 22 November redesign

- Status: accepted
- Date: 2026-11-23
- Topic: The ops console
- Amends [0301](0301-the-console-look-to-the-22-november-redesign.md) on the frame and the shared parts' look, and
  [0025](0025-phase-2-conflicts-register.md) item 59 on where gold stands in the console

## Context

The redesign's second piece is Work: Today, Tasks, Dispatch and Messages (docs/prompts/ops-redesign.md, step 6). The
first piece set the console's colours, type and sizes; what it left of the design system, the frame's head, titles,
figures and pills, is drawn on every Work screen, so it comes with this one. The owner ruled on 23 November that
Needs you is grouped by kind, Dispatch keeps its unassigned tray and opens on the day, and that New task (ADR 0302)
and Snooze (ADR 0303) are built here.

## Decision

1. **The frame**: the brand kit's lockup in gilt, a rule, then "Ops"; group names as written, at 12 px; a count with
   some overdue on a gilt pill; the column 236 px. Gold in the console still comes through the side navigation's own
   role (`--nav-mark`) alone, now on the lockup and the overdue pill as well as the chosen entry: the redesign draws
   it there.
2. **The shared parts' look, through roles whose defaults keep the other apps as they were** (packages/ui/base.css):
   titles in Plex's semibold, a page's 24 px, a drawer's 18 and a card's 15; a row of figures one strip, two to a
   phone's row, each 26 px semibold; a state's badge a 22 px pill with a dot.
3. **Today**: Needs you lists the board by kind, why each waits and a pill for when its first is due, each kind opening
   Tasks on it (`/tasks?kind=`); a home's side panel opens its page from a small button; every visit on the road
   wears its state, Booked where nothing else applies.
4. **Dispatch**: a consultation and fit in one visit is a kind of its own on the board (each block's `one_visit`),
   and a row of chips shows one kind alone on the day, the week and the tray (the redesign's C1); each kind takes the
   redesign's colour through the visit roles. The visit panel names its client as a link to their page (C3), Call and
   WhatsApp beneath its head, Cancel visit at its foot's left and Move its primary at its right. The unassigned tray
   stays beneath the board: a visit with no time yet has no place on the day's row of visits nobody is on.
5. **Messages**: the client's name heads their chat as a link to their page (A5), and the views read Waiting on us,
   Mine, Waiting on client, Closed and All (A7).

## Consequences

- The client app, the technician app and the site look as they did: each role's default is their value.
- What the Work screens still draw differently from the prototype is listed in the pull request and left to the next
  pieces: the day view's lanes, the phone's header and tab bar, and the Tasks table's own look.
