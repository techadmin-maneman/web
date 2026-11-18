# 0258. The technician app's design pass

- Status: accepted
- Date: 2026-11-12
- Topic: Field work
- Builds on [0239](0239-technician-light-look.md), whose look each change follows, and
  [0251](0251-hindi-and-the-sign-in.md), the last PR of the redesign this pass finishes
- Amends [0245](0245-the-steps.md) and [0249](0249-schedule-kit-and-me.md): the guided tasks, and Kit's week

## Context

With the eleven PRs of the technician redesign landed, the approved prototype (`design/tech-redesign/`) was set beside
the built app, screen by screen at 390 px, first with the browser tests' own data and then with the prototype's: its
four jobs, the week, a stocked kit, its alerts, leave, history and client alert, the phone's clock at 9:02 am. 71
differences no record explained. The owner ruled on each on 12 November 2026, accepting or rejecting a recommendation
for every one, and ruled the guided task's tick and Tick all off.

## Decision

1. **The app matches the prototype** wherever the owner accepted it: 61 differences, among them the sign-in's one line
   to ops, the code step's "Code sent to", Today's comma and rule, Schedule's "Today," and spans written "12 to 18 Nov",
   the small section heads, rows and rules inside the gutter, Leave's days written out, every form's labels small and
   quiet, the alert's time above its title, the job's distance and history count, the door's "Booked for", the
   camera's ✕ and "1 of 5 · Front", the instructions numbered on ruled rows, "+ Add item", the outcome's Result rows and
   Summary, and Visit closed's Duration from the check-in to the close, Payment, client and drive. The sign-in keeps its
   own bold labels, as its redraw from the owner's screenshots set ([0251](0251-hindi-and-the-sign-in.md)).
2. **Kept as built, and recorded here**, where the owner accepted the recommendation to keep:
   - The focused field's ring: the app's one focus ring, which keyboard and switch users need.
   - A full code signs in at once: a code the phone fills from the SMS needs no tap; Sign in stays for one typed short.
   - An empty kit's Call ops and WhatsApp ops: the prototype draws no empty kit.
   - Alerts' switches: each kind changes the moment it is touched, as the console's settings do.
   - The language sheet's Close: a way out without choosing, which a screen reader needs.
   - The camera's corner marks and pose line, which line the five shots up visit to visit for Compare; the thumbnails
     go bare.
3. **Rejected by the owner.** Three stay as built: हिन्दी alone, with no "Hindi" under it; the client alert on the job
   with its bullets; and a consumable's two lines. The fourth rejected a recommendation to keep the Safety shield
   before the check-in, so it moves: it shows from the door on, as the prototype has it.
4. **A guided task has no tick and no Tick all.** Next task moves through the tasks one by one, and the last lands the
   checklist with every item done. A visit with something not done is closed as partly done, with its reason. The phone
   keeps the task it is on, so it opens there again.
5. **What the API adds for it**: the day's list gives each drive's km beside its minutes, from the same estimate
   (`src/policy/drive-estimate.ts`), and none for a job still locked, which would sharpen where home is; the job's
   card counts the client's earlier visits and dates the first; and Kit's week ahead counts its bookings and lists, for
   each product, the pieces its fits need against the kit's, counted by product alone: a first fit by the product it
   was booked as, a replacement by the client's own, and a consultation and fit in one visit not at all, as its client
   chooses at the visit. The evening's check, which fits each piece to its client, reads a one visit and a first fit
   with no profile its own way ([0184](0184-the-one-visit-range.md)). The pieces are shown only: an ask of ops stays with
   consumables, as the evening's check fits pieces to each client ([0181](0181-tomorrows-kits.md)). The phone's store reads a card and a day kept
   before these as saying neither, until they are read again (version 13).

## Departures from the prototype

- **A hair system part received.** The prototype draws Scan and Report missing. Where some pieces are in hand and the
  rest are still on the way, a quiet "Receive 1 scanned · the rest to come" receives what is in hand, so a piece can be
  fitted before the rest arrive. Typing a label the camera can't read is inside the scanner, as the owner accepted.
- **Outlined buttons' edge** is grey at a control's 3:1 (`--stone`), not the prototype's lighter rule, as 0239 set for
  fields (WCAG 1.4.11).
- **A drive's link to Google Maps** takes its whole hatched block on Schedule, which is as tall as the drive is long:
  a short drive's is less than the 44 px a tap is held to. The job's own Navigate is the full-size way there.

## Consequences

- `@maneman/ui` gains a day written out over the phone's own date input (`DayInput`), a problem card whose title runs
  into its words (`runIn`), and a row lead width, a ruled choice's height and an outlined button's edge a look can
  set, each defaulting to what the other apps drew before.
- The browser tests walk a visit's tasks with Next task (`throughTheTasks`).
- The door's "Checked in · 40 m away" waits for the phone apps' full-width toast, which sits above the action bar:
  the shared toast as it stands sits over Start visit. Until then the door's head says when the check-in was made.
