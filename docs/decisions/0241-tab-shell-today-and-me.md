# 0241. The technician app's tab bar, Today redrawn, and Me with sign out

- Status: accepted
- Date: 2026-11-10
- Topic: Field work
- Follows [0239](0239-technician-light-look.md)

## Context

PR 3 of the technician redesign (`docs/technician-redesign/PLAN.md`, section 6) draws the tab bar and Today from the
prototype (`design/tech-redesign/Technician App.prototype.html`) in the new look. The prototype's Today leaves out
signing out, which the brief puts on Me, and Me's other screens come in later PRs. Today's next job and rows say when to
leave, which the API did not give.

## Decision

1. **Four tabs, Today, Schedule, Kit and Me, under every top-level screen and inside no job.** The bar takes the look
   of the screen above it, so a screen not yet redrawn keeps its ink to the foot. Until PR 9, Schedule opens the week
   and Kit the kit as they are.
2. **Today, as the prototype draws it:** the date, the jobs still to do (the count falls as each closes), and the sync
   label, which says how many writes failed where the API stopped any; a problem card for each of yesterday's open
   jobs and for unsent work at risk; the next job, one under way or at its door first, with when to leave (counted
   down while the screen is open), its time, client, visit, payment, place and drive, and Navigate, Message and Call;
   Later today, each row with where it stands, a job done with ruled in the ink with how it closed; Day view; and
   tomorrow's line, which opens the Schedule.
3. **Each job on the day's list carries `drive_minutes` and `leave_by`:** the drive from the job before, or from the
   technician's home pin for the day's first, by the drive estimate (`src/policy/next-job.ts`), never Google's, which a
   list read on every open would call too often. With no home pin the day's first has neither, as booking counts no
   drive from nowhere. A job not yet unlocked has them too, for the Schedule's drive before each job (PR 9): the drive
   tells the technician how far it is from them, no more.
4. **Me, with what Today held:** sign out behind its sheet, the month, leave, pending uploads with their count, and ops.
   Quality, incentives, guides, language and alerts come with their screens (PRs 9 to 11).
5. **The shared parts take the look through roles,** each defaulting to what the console and the client app draw now:
   the tab bar's current mark (`--tab-mark`), a sheet's panel (`--sheet-ground`, `--sheet-text`), a list's edge and its
   rows' sizes (`--list-edge`, `--row-*`); `ConfirmSheet` draws on paper (`onPaper`), the safe answer first and filled;
   `ListRow` rules a row done with (`done`).
6. **A phone's upgrade runs every step's change to one store in a single pass** (`apps/tech/src/store/upgrades.ts`):
   two passes each read a record before the other wrote it, so the second wrote the first's change away. Version 9 gives
   a kept day's rows no drive until the day is read again.

## Where the build departs from the prototype, and why

- **No bell yet.** Alerts and their count come with web push in PR 10.
- **Message opens WhatsApp** to the client, as the job card does, until the Message sheet in PR 5.
- **Day view and tomorrow open the week** as it is until the Schedule's day view in PR 9.
- **The rows' chevrons are `--ink-500`, not `--stone`:** the look's pairings hold every glyph in a row to 4.5:1.
- **The storage-full and stopped banners keep their ink** above Today until PR 7 redraws them. The update banner
  already draws on paper above Today and Me.

## Consequences

- PR 9 replaces the Schedule, Kit and Me screens behind the tabs; PR 10 adds the bell to Today's head.
- Every step that changes a store through `eachAgain` now sees what an earlier one of them changed in the same upgrade:
  PR 2's step 8 would otherwise have written away a card's step-7 arrival window on a phone last opened at version 6.
  Two older paths still lose a change, and are left as they are since an old step is never edited: from version 3,
  steps 4 and 5 each pass over the cards, so the second writes away the first's `lost_reasons`; and from version 1 or
  2, what step 3 moves into the new stores lands after the later steps have read them empty. Only a phone last opened
  before 12 October 2026, before production launched, takes either path.
