# 0258. The technician app's design pass

- Status: accepted
- Date: 2026-11-12
- Topic: Field work
- Builds on [0239](0239-technician-light-look.md), whose look each change follows, and
  [0251](0251-hindi-and-the-sign-in.md), the last PR of the redesign this pass finishes
- Amends [0245](0245-the-steps.md) on the guided tasks: no tick on a task, and no Tick all; and
  [0249](0249-schedule-kit-and-me.md) on Kit: the week ahead counts its bookings and its hair systems

## Context

With the eleven PRs of the technician redesign landed, the approved prototype (`design/tech-redesign/`) was set beside
the built app, screen by screen at 390 px, first with the browser tests' own data and then with the prototype's: its
four jobs, the week, a stocked kit, its alerts, leave, history and client alert, the phone's clock at 9:02 am. 71
differences no record explained. The owner ruled on each on 12 November 2026, accepting or rejecting a recommendation
for every one, and ruled the guided task's tick and Tick all off.

## Decision

1. **The app matches the prototype** wherever the owner accepted it: 61 differences, among them the sign-in's one line
   to ops, the code step's "Code sent to", Today's comma and rule, Schedule's "Today," and spans written "12 to 18 Nov",
   the small section heads, rows and rules inside the gutter, Leave's days written out, the alert's time above its
   title, the job's distance and history count, the door's "Booked for", the camera's ✕ and "1 of 5
   · Front", the instructions numbered on ruled rows, "+ Add item", the outcome's Result rows and Summary, and Visit
   closed's Duration, Payment, client and drive.
2. **Kept as built, and recorded here**, where the owner accepted the recommendation to keep:
   - The focused field's ring: the app's one focus ring, which keyboard and switch users need.
   - A full code signs in at once: a code the phone fills from the SMS needs no tap; Sign in stays for one typed short.
   - An empty kit's Call ops and WhatsApp ops: the prototype draws no empty kit.
   - Alerts' switches: each kind changes the moment it is touched, as the console's settings do.
   - The language sheet's Close: a way out without choosing, which a screen reader needs.
   - The camera's corner marks and pose line, which line the five shots up visit to visit for Compare; the thumbnails
     go bare.
3. **Rejected by the owner, so as built**: हिन्दी stays alone, with no "Hindi" under it; the client alert on the job
   keeps its bullets; a consumable keeps its two lines; and the Safety shield shows from the door on, as the prototype
   has it, not before the check-in.
4. **A guided task has no tick and no Tick all.** Next task moves through the tasks one by one, and the last lands the
   checklist with every item done. A visit with something not done is closed as partly done, with its reason. The phone
   keeps the task it is on, so it opens there again.
5. **What the API adds for it**: the day's list gives each drive's km beside its minutes, from the same estimate
   (`src/policy/drive-estimate.ts`); the job's card counts the client's earlier visits and dates the first; and Kit's
   week ahead counts its bookings and lists, for each product, the pieces its first fits and replacements need against
   the kit's. The pieces are shown only: an ask of ops stays with consumables, as the evening's check fits pieces to
   each client ([0181](0181-tomorrows-kits.md)).

## Departures from the prototype

- **A hair system part received.** The prototype draws Scan and Report missing. Where some pieces are in hand and the
  rest are still on the way, a quiet "Receive 1 scanned · the rest to come" receives what is in hand, so a piece can be
  fitted before the rest arrive. Typing a label the camera can't read is inside the scanner, as the owner accepted.
- **Outlined buttons' edge** is grey at a control's 3:1 (`--stone`), not the prototype's lighter rule, as 0239 set for
  fields (WCAG 1.4.11).
- **Leave's labels** are small and muted on Leave alone, as the prototype draws them there; the sign-in's and the
  outcome's stay bold, as the prototype draws those.

## Consequences

- `@maneman/ui` gains a day written out over the phone's own date input (`DayInput`), a problem card whose title runs
  into its words (`runIn`), a row lead width and an outlined button's edge a look can set, each defaulting to what the
  other apps drew before.
- The browser tests walk a visit's tasks with Next task (`throughTheTasks`).
- The door's "Checked in · 40 m away" waits for the phone apps' full-width toast, which sits above the action bar:
  the shared toast as it stands sits over Start visit. Until then the door's head says when the check-in was made.
